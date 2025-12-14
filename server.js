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
    // Increase server timeout to 10 minutes
    req.setTimeout(600000);
    res.setTimeout(600000);

    // --- UNIVERSAL API KEY LOGIC ---
    // 1. Try to get key securely from the environment (Used by Render/Production)
    let apiKey = process.env.WAVESPEED_API_KEY;
    
    // 2. Fallback to key sent from the frontend form (Used for Local Testing)
    if (!apiKey) {
        apiKey = req.body.apiKey; 
    }
    
    // Get other job details from the frontend
    let { apiUrl, payload } = req.body;
    
    try {
        // Final Key Check
        if (!apiKey || apiKey.trim() === "") {
            const environment = process.env.NODE_ENV === 'production' ? 'Render' : 'local form input';
            return res.status(500).json({ error: `API Key is missing. Please provide it in the ${environment}.` });
        }
        
        apiUrl = clean(apiUrl);
        if (payload.images && payload.images[0]) {
            payload.images[0] = clean(payload.images[0]);
        }

        console.log(`\n--> New Job received. Prompt: "${payload.prompt}"`);

        // 1. Send Job to WaveSpeed (using the determined key)
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
            await wait(4000); // Check every 4 seconds

            const checkReq = await fetch(statusUrl, {
                headers: { "Authorization": `Bearer ${apiKey}` }
            });
            const checkData = await checkReq.json();
            
            const root = checkData.data || checkData;
            const status = root.status;
            
            process.stdout.write(`\r   Attempt ${i}: Status = ${status}     `);

            if (status === "succeeded" || status === "completed") {
                console.log("\n✅ Job Complete! Sending image to UI.");
                return res.json(root);
            }

            if (status === "failed") {
                console.log("\n❌ Job Failed.");
                return res.status(500).json({ error: "WaveSpeed failed to process the image." });
            }
        }

        console.log("\n❌ TIMEOUT: Gave up after 6.6 minutes.");
        res.status(504).json({ error: "Timeout: Server took too long to respond." });

    } catch (err) {
        console.error(`\n❌ System Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// --- RENDER PORT LOGIC ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`\n✅ SERVER READY. Listening on port ${PORT}`));