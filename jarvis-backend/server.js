const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
    console.error("FATAL ERROR: GROQ_API_KEY not found in .env file.");
    process.exit(1);
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, carState } = req.body;

        const systemPrompt = `
            You are JARVIS, a friendly, helpful, and slightly witty AI companion integrated into a car's dashboard. Your primary goal is to assist the driver. Keep your responses concise and conversational.

            Current Vehicle Status (Only mention this data if the user asks for it specifically):
            - Oil Life: ${carState.oilLife.percentage}% (${carState.oilLife.status})
            - Brake System Health: ${carState.brakeSystem.health}% (Pad Thickness: ${carState.brakeSystem.padThickness}mm)
            - Coolant System: Fluid Level at ${carState.coolantSystem.fluidLevel}% (${carState.coolantSystem.status})
            - Battery Health: ${carState.batteryHealth.healthScore}% (${carState.batteryHealth.status})
        `;

        const response = await axios.post(
            GROQ_API_URL,
            {
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                model: 'llama3-8b-8192',
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const reply = response.data.choices[0].message.content;

        res.json({ reply: reply });

    } catch (error) {
        console.error("Error in /api/chat:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Failed to get response from AI" });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
