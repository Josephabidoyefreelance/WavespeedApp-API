import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path"; 
import { fileURLToPath } from "url"; 

const app = express();
app.use(cors());

// ✅ ALLOW LARGE PAYLOADS (200MB)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Helper
const clean = (str) => (str ? str.trim().replace(/["']/g, "") : "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post("/generate", async (req, res) => {
    req.setTimeout(900000); // 15 mins
    res.setTimeout(900000);

    let apiKey = process.env.WAVESPEED_API_KEY || req.body.apiKey;
    let { apiUrl, payload } = req.body;
    
    try {
        if (!apiKey) return res.status(500).json({ error: "API Key missing." });
        
        console.log(`--> Job Start: ${payload.images ? payload.images.length : 0} images.`);

        const startReq = await fetch(clean(apiUrl), {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!startReq.ok) {
            const err = await startReq.text();
            return res.status(400).json({ error: `WaveSpeed Error: ${err}` });
        }

        let data = await startReq.json();
        let statusUrl = data.urls?.get || data.data?.urls?.get;

        if (!statusUrl) return res.json(data);

        // Poll Loop
        for (let i = 1; i <= 100; i++) {
            await wait(4000);
            const checkReq = await fetch(statusUrl, { headers: { "Authorization": `Bearer ${apiKey}` } });
            const checkData = await checkReq.json();
            let root = checkData.data || checkData;
            
            if (root.status === "succeeded" || root.status === "completed") {
                if (root.outputs) {
                    root.outputs = root.outputs.map(o => {
                        if(typeof o === 'string' && o.includes('base64,')) return { data: o.split('base64,')[1] };
                        if(typeof o === 'string') return { data: o };
                        return o;
                    });
                }
                return res.json(root);
            }
            if (root.status === "failed") return res.status(500).json({ error: "Job Failed." });
        }
        res.status(504).json({ error: "Timeout." });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ SERVER READY on PORT ${PORT}`));