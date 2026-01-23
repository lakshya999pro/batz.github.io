import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";

import cors from "cors";

const app = express();
app.use(cors());

const SOURCE_URL = "https://dlhd.dad";

/* ===============================
   CRICKET FILTER
================================ */
function isCricket(text = "") {
  const keywords = [
    "cricket",
    "icc",
    "ipl",
    "odi",
    "test",
    "t20",
    "u19",
    "ashes",
    "bbl",
    "psl",
    "cpl",
    "wc",
    "world cup"
  ];

  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

/* ===============================
   API ENDPOINT
================================ */
app.get("/api/schedule", async (req, res) => {
  try {
    const { data: html } = await axios.get(SOURCE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    const $ = cheerio.load(html);
    const result = [];

    $(".schedule__category").each((_, category) => {
      const league = $(category).find(".card__meta").text().trim();

      // ❌ Skip non-cricket leagues
      if (!isCricket(league)) return;

      const matches = [];

      $(category)
        .find(".schedule__event")
        .each((__, event) => {
          const time = $(event).find(".schedule__time").text().trim();
          const title = $(event)
            .find(".schedule__eventTitle")
            .text()
            .trim();

          // ❌ Extra safety: skip non-cricket matches
          if (!isCricket(title)) return;

          const channels = [];
          $(event)
            .find(".schedule__channels a")
            .each((___, ch) => {
              channels.push($(ch).text().trim());
            });

          matches.push({
            time,
            title,
            channels
          });
        });

      if (matches.length > 0) {
        result.push({
          league,
          matches
        });
      }
    });

    res.json({
      source: "DaddyLiveHD",
      sport: "Cricket",
      updatedAt: new Date().toISOString(),
      data: result
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to fetch cricket schedule"
    });
  }
});

/* ===============================
   SERVER START
================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏏 Cricket Schedule API running`);
  console.log(`👉 http://localhost:${PORT}/api/schedule`);
});
