import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import fs from "fs";


const app = express();
app.use(cors());

const SOURCE_URL = "https://dlhd.dad";

/* ===============================
   LOAD CDN FILE (LOCAL)
================================ */
const cdnRaw = JSON.parse(fs.readFileSync("./test.json", "utf8"));
const cdnChannels = Array.isArray(cdnRaw?.channels)
  ? cdnRaw.channels
  : [];

console.log("✅ CDN FILE LOADED:", cdnChannels.length, "channels");

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

function isIndia(title = "") {
  return /(india|ind\b|bharat)/i.test(title);
}

/* ===============================
   DATE CLEANER (CRITICAL FIX)
================================ */
function cleanDate(dateStr = "") {
  // Example:
  // "Friday 23rd Jan 2026 - Schedule Time UK GMT"

  return dateStr
    .replace(/-\s*schedule.*$/i, "")       // remove "- Schedule Time UK GMT"
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1") // remove ordinal suffix
    .replace(/,/g, "")
    .trim();
}

/* ===============================
   TIME → IST (FROM UK GMT)
================================ */
function toIST(dateStr, timeStr) {
  const clean = cleanDate(dateStr);

  const d = new Date(`${clean} ${timeStr} GMT`);

  if (isNaN(d.getTime())) {
    console.error("❌ Invalid date after cleanup:", clean, timeStr);
    return "TBA";
  }

  return (
    d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }) + " IST"
  );
}

/* ===============================
   PARSE DAY (FOR OLD MATCH FILTER)
================================ */
function parseDay(dateStr) {
  const clean = cleanDate(dateStr);
  const d = new Date(`${clean} GMT`);
  d.setHours(0, 0, 0, 0);
  return d;
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

      const matchDay = parseDay(dayTitle);
      if (matchDay < today) return; // ❌ remove old matches

      $(day)
        .find(".schedule__event")
        .each((__, event) => {
          const rawTime = $(event).find(".schedule__time").text().trim();
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

          const sportLower = sport.toLowerCase();

          // ✅ ONLY CRICKET & FOOTBALL
          if (
            !sportLower.includes("cricket") &&
            !sportLower.includes("football")
          ) return;

          // Optional filter
          if (
            sportFilter !== "all" &&
            !sportLower.includes(sportFilter)
          ) return;

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
            time: toIST(dayTitle, rawTime),
            title,
            sport,
            isLive: isLive(title),
            isIndia: isIndia(title),
            channels
          });
        });
    });

    /* ===============================
       SORTING
    ================================ */
    matches.sort((a, b) => {
      if (a.isLive !== b.isLive) return b.isLive - a.isLive;
      if (a.isIndia !== b.isIndia) return b.isIndia - a.isIndia;
      return parseDay(a.date) - parseDay(b.date);
    });

    res.json({
      source: "DaddyLiveHD",
      timezone: "Asia/Kolkata",
      updatedAt: new Date().toISOString(),
      total: matches.length,
      data: matches
    });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.status(500).json({
      error: "Failed to build schedule"
    });
  }
});

/* ===============================
   START SERVER
================================ */
const PORT = 3000;
app.listen(PORT, () => {
  console.log("🚀 Sports Schedule API running");
  console.log(`👉 http://localhost:${PORT}/api/schedule`);
});
