const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration for Render deployment
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cookie storage
let cookieCache = {
  value: '',
  timestamp: 0
};

const BASE_URL = 'https://net51.cc';
const headers = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
};

// Bypass function to get cookie
async function bypass() {
  // Return cached cookie if valid (less than 15 hours old)
  if (cookieCache.value && (Date.now() - cookieCache.timestamp) < 54000000) {
    console.log('Using cached cookie');
    return cookieCache.value;
  }

  console.log('Fetching new cookie...');
  try {
    let verifyResponse;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
      try {
        verifyResponse = await axios.post(`${BASE_URL}/tv/p.php`, {}, { 
          headers,
          timeout: 15000,
          validateStatus: () => true
        });
        
        attempts++;
        console.log(`Bypass attempt ${attempts}, response:`, verifyResponse.data);
        
        if (attempts >= maxAttempts) {
          console.log('Max attempts reached');
          break;
        }
        
        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (err) {
        console.error('Bypass request error:', err.message);
        attempts++;
        if (attempts >= maxAttempts) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } while (!verifyResponse?.data?.includes('"r":"n"'));
    
    if (verifyResponse && verifyResponse.headers['set-cookie']) {
      const cookies = verifyResponse.headers['set-cookie'];
      const tHashT = cookies?.find(c => c.startsWith('t_hash_t='))?.split(';')[0].split('=')[1] || '';
      
      if (tHashT) {
        cookieCache = {
          value: tHashT,
          timestamp: Date.now()
        };
        console.log('New cookie obtained successfully');
        return tHashT;
      }
    }
    
    console.error('Failed to obtain cookie');
    return '';
  } catch (error) {
    console.error('Bypass error:', error.message);
    return '';
  }
}

// Get cookies string
async function getCookies() {
  const cookie = await bypass();
  return `t_hash_t=${cookie}; ott=nf; hd=on`;
}

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cookie: cookieCache.value ? 'cached' : 'none',
    cookieAge: cookieCache.timestamp ? Math.floor((Date.now() - cookieCache.timestamp) / 1000 / 60) : 0
  });
});

// API Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    cookie: cookieCache.value ? 'cached' : 'none',
    cookieAge: cookieCache.timestamp ? Math.floor((Date.now() - cookieCache.timestamp) / 1000 / 60) : 0
  });
});

// Home page endpoint
app.get('/api/home', async (req, res) => {
  try {
    console.log('Home endpoint called');
    const cookieStr = await getCookies();
    
    if (!cookieStr.includes('t_hash_t=')) {
      throw new Error('Failed to obtain authentication cookie');
    }
    
    const response = await axios.get(`${BASE_URL}/mobile/home?app=1`, {
      headers: {
        ...headers,
        'Cookie': cookieStr,
        'Referer': `${BASE_URL}/`
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }

    const $ = cheerio.load(response.data);
    
    const sections = [];
    $('.tray-container, #top10').each((i, elem) => {
      const title = $(elem).find('h2, span').first().text().trim();
      const items = [];
      
      $(elem).find('article, .top10-post').each((j, item) => {
        let id = $(item).attr('data-post');
        if (!id) {
          const imgSrc = $(item).find('img').attr('data-src') || $(item).find('img').attr('src') || '';
          id = imgSrc.split('/').pop().split('.')[0];
        }
        
        const itemTitle = $(item).find('img').attr('alt') || '';
        
        if (id && itemTitle) {
          items.push({
            id,
            title: itemTitle,
            poster: `https://imgcdn.kim/poster/v/${id}.jpg`
          });
        }
      });
      
      if (items.length > 0) {
        sections.push({ title, items });
      }
    });

    console.log(`Home: Found ${sections.length} sections`);
    res.json({ sections });
  } catch (error) {
    console.error('Home error:', error.message);
    res.status(500).json({ error: error.message, sections: [] });
  }
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    console.log('Search:', query);
    const cookieStr = await getCookies();
    const timestamp = Date.now();
    
    const response = await axios.get(`${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${timestamp}`, {
      headers: {
        ...headers,
        'Cookie': cookieStr,
        'Referer': `${BASE_URL}/tv/home`
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }

    const searchData = response.data;
    const results = (searchData.searchResult || []).map(item => ({
      id: item.id,
      title: item.t,
      poster: `https://img.nfmirrorcdn.top/poster/v/${item.id}.jpg`
    }));

    console.log(`Search: Found ${results.length} results`);
    res.json({ results });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
});

// Load details endpoint
app.get('/api/load/:id', async (req, res) => {
  try {
    const id = req.params.id;
    console.log('Load details for:', id);
    
    const cookieStr = await getCookies();
    const timestamp = Date.now();
    
    const response = await axios.get(`${BASE_URL}/post.php?id=${id}&t=${timestamp}`, {
      headers: {
        ...headers,
        'Cookie': cookieStr,
        'Referer': BASE_URL
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = response.data;
    let episodes = [];

    // Handle missing or undefined episodes array
    if (!data.episodes || data.episodes.length === 0 || data.episodes[0] === null) {
      episodes.push({
        id,
        name: data.title || 'Unknown',
        episode: null,
        season: null
      });
    } else {
      episodes = data.episodes.filter(ep => ep !== null && ep !== undefined).map(ep => ({
        id: ep.id,
        name: ep.t || 'Episode',
        episode: ep.ep ? ep.ep.replace('E', '') : '1',
        season: ep.s ? ep.s.replace('S', '') : '1',
        poster: `https://img.nfmirrorcdn.top/epimg/150/${ep.id}.jpg`,
        runtime: ep.time || ''
      }));
    }

    console.log(`Load: ${data.title}, ${episodes.length} episodes`);
    res.json({
      title: data.title || 'Unknown Title',
      description: data.desc || '',
      year: data.year || '',
      cast: data.cast ? data.cast.split(',').map(c => c.trim()).filter(c => c) : [],
      genre: data.genre ? data.genre.split(',').map(g => g.trim()).filter(g => g) : [],
      runtime: data.runtime || '',
      poster: `https://img.nfmirrorcdn.top/poster/v/${id}.jpg`,
      background: `https://img.nfmirrorcdn.top/poster/h/${id}.jpg`,
      episodes,
      type: (!data.episodes || data.episodes.length === 0 || data.episodes[0] === null) ? 'movie' : 'series'
    });
  } catch (error) {
    console.error('Load error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get video links endpoint
app.get('/api/links/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const title = req.query.title || '';
    console.log('Get links for:', id, title);
    
    const cookieStr = await getCookies();
    const timestamp = Date.now();
    
    const response = await axios.get(`${BASE_URL}/tv/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${timestamp}`, {
      headers: {
        ...headers,
        'Cookie': cookieStr,
        'Referer': `${BASE_URL}/tv/home`
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }

    const playlist = response.data;
    const links = [];
    const subtitles = [];

    if (Array.isArray(playlist)) {
      playlist.forEach(item => {
        if (item.sources && Array.isArray(item.sources)) {
          item.sources.forEach(source => {
            const url = source.file.startsWith('http') ? source.file : `${BASE_URL}${source.file.replace('/tv/', '/')}`;
            links.push({
              url: url,
              label: source.label || 'Auto',
              quality: source.file.includes('q=') ? source.file.split('q=')[1].split('&')[0] : 'Auto'
            });
          });
        }

        if (item.tracks && Array.isArray(item.tracks)) {
          item.tracks.filter(t => t.kind === 'captions').forEach(track => {
            subtitles.push({
              label: track.label || 'Unknown',
              file: track.file && track.file.startsWith('http') ? track.file : `https:${track.file}`
            });
          });
        }
      });
    }

    console.log(`Links: Found ${links.length} links, ${subtitles.length} subtitles`);
    res.json({ links, subtitles });
  } catch (error) {
    console.error('Links error:', error.message);
    res.status(500).json({ error: error.message, links: [], subtitles: [] });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Netflix Mirror Server running on port ${PORT}`);
  console.log(`📺 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Server started at ${new Date().toISOString()}`);
});