import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());

const SOURCE_URL = "https://dlhd.dad";

/* ===============================
   LOAD CDN FILE
================================ */
const cdnRaw = JSON.parse(fs.readFileSync("./test.json", "utf8"));
const cdnChannels = Array.isArray(cdnRaw?.channels) ? cdnRaw.channels : [];

/* ===============================
   HELPERS
================================ */
function tokenize(str = "") {
  return str
    .toLowerCase()
    .replace(/\b(hd|sd|4k|uk|us|usa|nz|au)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(w => w.length > 1);
}

function findChannel(name) {
  const target = tokenize(name);
  let best = null;
  let score = 0;

  for (const ch of cdnChannels) {
    if (!ch?.name) continue;
    const tokens = tokenize(ch.name);
    const s = target.filter(t => tokens.includes(t)).length;
    if (s > score) {
      score = s;
      best = ch;
    }
  }
  return score > 0 ? best : null;
}

function isLive(title = "") {
  return /(live|now)/i.test(title);
}

function isIndiaMatch(title = "") {
  return /(india|ind\b|bharat)/i.test(title);
}

function parseDate(dateStr) {
  // "Friday, 23 January 2026"
  return new Date(dateStr);
}

/* ===============================
   API ENDPOINT
================================ */
app.get("/api/schedule", async (req, res) => {
  try {
    const sportFilter = (req.query.sport || "all").toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: html } = await axios.get(SOURCE_URL, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(html);
    let matches = [];

    $(".schedule__day").each((_, day) => {
      const dayTitle = $(day)
        .find(".schedule__dayTitle")
        .text()
        .trim();

      const matchDate = parseDate(dayTitle);
      matchDate.setHours(0, 0, 0, 0);

      // ❌ REMOVE OLD MATCHES
      if (matchDate < today) return;

      $(day)
        .find(".schedule__event")
        .each((__, event) => {
          const time = $(event).find(".schedule__time").text().trim();
          const title = $(event)
            .find(".schedule__eventTitle")
            .text()
            .trim();

          const sport =
            $(event)
              .closest(".schedule__category")
              .find(".card__meta")
              .text()
              .trim() || "Other";

          // SPORT FILTER
          if (sportFilter !== "all" &&
              !sport.toLowerCase().includes(sportFilter)) return;

          const channels = [];

          $(event)
            .find(".schedule__channels a")
            .each((___, ch) => {
              const name = $(ch).text().trim();
              const match = findChannel(name);

              channels.push({
                name,
                logo: match?.image || null,
                url: match?.url || null,
                status: match?.status || null
              });
            });

          matches.push({
            date: dayTitle,
            time,
            title,
            sport,
            isLive: isLive(title),
            isIndia: isIndiaMatch(title),
            channels
          });
        });
    });

    /* ===============================
       SORTING LOGIC
    ================================ */
    matches.sort((a, b) => {
      // LIVE first
      if (a.isLive !== b.isLive) return b.isLive - a.isLive;

      // India matches next
      if (a.isIndia !== b.isIndia) return b.isIndia - a.isIndia;

      // Earlier matches first
      return new Date(a.date) - new Date(b.date);
    });

    res.json({
      source: "DaddyLiveHD",
      updatedAt: new Date().toISOString(),
      total: matches.length,
      data: matches
    });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.status(500).json({ error: "Failed to build advanced schedule" });
  }
});

/* ===============================
   START SERVER
================================ */
const PORT = 3000;
app.listen(PORT, () => {
  console.log("🚀 Advanced Sports Schedule API running");
  console.log(`👉 http://localhost:${PORT}/api/schedule`);
});
