import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Helper: Fix common URL/String issues
const clean = (str) => (str ? str.trim().replace(/["']/g, "") : "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post("/generate", async (req, res) => {
    // Set a long timeout (10 mins)
    req.setTimeout(600000);
    res.setTimeout(600000);

    try {
        let { apiKey, apiUrl, payload } = req.body;
        
        // Clean inputs
        apiKey = clean(apiKey);
        apiUrl = clean(apiUrl);
        if (payload.images && payload.images[0]) {
            payload.images[0] = clean(payload.images[0]);
        }

        console.log(`\n--> New Job: "${payload.prompt}"`);

        // 1. Send Job to WaveSpeed
        const startReq = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!startReq.ok) {
            const err = await startReq.text();
            console.error("❌ API Refused Connection:", err);
            return res.status(400).json({ error: `WaveSpeed Error: ${err}` });
        }

        let data = await startReq.json();

        // 2. Find the Polling URL
        let statusUrl = null;
        if (data.urls && data.urls.get) statusUrl = data.urls.get;
        else if (data.data && data.data.urls && data.data.urls.get) statusUrl = data.data.urls.get;

        // If finished instantly
        if (!statusUrl) {
            console.log("✅ Finished Instantly");
            return res.json(data);
        }

        console.log(`--> Polling Status at: ${statusUrl}`);

        // 3. Wait Loop
        for (let i = 1; i <= 100; i++) {
            await wait(4000);

            const checkReq = await fetch(statusUrl, {
                headers: { "Authorization": `Bearer ${apiKey}` }
            });
            const checkData = await checkReq.json();
            
            // Handle different data wrappers
            const root = checkData.data || checkData;
            const status = root.status;
            
            // Log live status to terminal
            process.stdout.write(`\r   Attempt ${i}: Status = ${status}     `);

            // --- THE FIX IS HERE ---
            // We now check for "succeeded" OR "completed"
            if (status === "succeeded" || status === "completed") {
                console.log("\n✅ SUCCESS! Sending image to UI.");
                return res.json(root);
            }

            if (status === "failed") {
                console.log("\n❌ Job Failed.");
                return res.status(500).json({ error: "WaveSpeed failed to process the image." });
            }
        }

        res.status(504).json({ error: "Timeout: Server took too long to respond." });

    } catch (err) {
        console.error("\n❌ System Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log("\n✅ SERVER READY. Open your index.html now."));