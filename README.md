# CS2 HLTV Scraper

A Cloudflare-native scraping system for CS2 match data and betting odds from HLTV.org. Built for scale, reliability, and cost-effectiveness using Cloudflare's edge infrastructure.

## Architecture Overview

```
┌─────────────────┐    ┌───────────────────┐    ┌──────────────┐
│ Cloudflare      │    │ Python Container  │    │ Cloudflare   │
│ Worker          │───►│ (Scraping Logic)  │───►│ D1 Database  │
│ (Scheduling)    │    │                   │    │              │
└─────────────────┘    └───────────────────┘    └──────────────┘
         │                        │                      │
         │                        │                      │
         ▼                        ▼                      ▼
┌─────────────────┐    ┌───────────────────┐    ┌──────────────┐
│ Cloudflare KV   │    │ Cloudflare R2     │    │ External     │
│ (State/Config)  │    │ (Raw HTML)        │    │ Services     │
└─────────────────┘    └───────────────────┘    └──────────────┘
```

## Components

### 1. Python Container
**Purpose**: Execute heavy scraping operations with existing libraries  
**Technology**: Docker container running Python 3.10+ with Flask web server  
**Libraries**: beautifulsoup4, requests, pandas, cloudscraper, psycopg2-binary  

**Endpoints**:
- `POST /scrape-match` - Scrape historical match data
- `POST /scrape-odds` - Scrape pre-match betting odds  
- `GET /health` - Container health check

### 2. Cloudflare Worker
**Purpose**: Request routing, scheduling, lightweight orchestration  
**Technology**: TypeScript/JavaScript  

**Responsibilities**:
- Cron-triggered scraping jobs
- Route requests to appropriate containers
- Handle rate limiting and retry logic
- Coordinate data flow between services

### 3. Cloudflare D1 Database
**Purpose**: Structured data storage (replace PostgreSQL)  
**Schema**: Migrate existing tables (Matches, Games, Players, Teams, PlayerGameStats, Odds)  
**Features**: SQLite-compatible, global replication, integrated with Workers

### 4. Cloudflare R2 Storage
**Purpose**: Raw HTML file storage  
**Usage**: Store scraped HTML pages for debugging/archival  
**Structure**: Organized by date and match ID

### 5. Cloudflare KV
**Purpose**: Configuration and state management  

**Data**:
- Last scraped match IDs
- Proxy lists and rotation state
- Rate limiting counters
- Scraping configuration

## Current File Structure

```
csgo-scraper/
├── OddsScraper.py          # Minimal odds scraper (single URL)
├── csgocrawler.py          # Core scraping utilities
├── dbConnector.py          # Database connection handler
├── proxyManager.py         # Proxy rotation management
├── EloHandler.py           # Player rating calculations
├── predictionHandler.py    # Match prediction logic
├── data/
│   ├── html_snapshots/     # Raw HTML storage (local)
│   └── logs/               # Application logs
├── poetry.lock             # Python dependencies
├── pyproject.toml          # Project configuration
└── README.md               # This file
```

## Target File Structure

```
csgo-scraper/
├── container/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── scraper_server.py
│   ├── csgocrawler.py
│   ├── OddsScraper.py
│   ├── dbConnector.py
│   └── proxyManager.py
├── worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── scheduler.ts
│   │   └── container-client.ts
│   ├── wrangler.toml
│   └── package.json
├── database/
│   ├── schema.sql
│   ├── migration.sql
│   └── seed-data.sql
└── README.md
```

## Features

### Current
- ✅ Single-URL odds scraping from HLTV
- ✅ HTML snapshot saving with timestamps
- ✅ Provider name extraction and clean output formatting
- ✅ Configurable storage backends (local/R2 ready)
- ✅ Comprehensive error handling and logging

### In Development
- 🚧 Cloudflare Worker integration
- 🚧 D1 database migration
- 🚧 R2 HTML storage
- 🚧 Scheduled scraping jobs

## Quick Start

### Prerequisites
- Python 3.10+
- Poetry for dependency management

### Installation
```bash
git clone https://github.com/JEndler/csgogamble.git
cd csgogamble
poetry install
```

### Usage
```bash
# Basic odds scraping
poetry run python OddsScraper.py "https://www.hltv.org/matches/2383214/match-url"

# Save HTML snapshots
poetry run python OddsScraper.py "https://www.hltv.org/matches/2383214/match-url" --save-html

# Future: R2 storage
poetry run python OddsScraper.py "URL" --save-html --storage=r2
```

## Deployment

### Container Deployment
*Coming soon - Docker containerization for Cloudflare deployment*

### Worker Deployment  
*Coming soon - Cloudflare Worker setup and deployment*

### Database Setup
*Coming soon - D1 database schema and migration scripts*

## Roadmap

### Phase 1: Infrastructure Migration
- [ ] Containerize Python scraping logic
- [ ] Deploy Cloudflare Worker for orchestration
- [ ] Migrate PostgreSQL to Cloudflare D1
- [ ] Implement R2 HTML storage
- [ ] Set up KV for configuration management

### Phase 2: Enhanced Scraping
- [ ] Automated match discovery and scraping
- [ ] Historical data backfill
- [ ] Real-time odds monitoring
- [ ] Advanced proxy rotation

### Phase 3: Analytics & Predictions
- [ ] Migrate Elo rating system
- [ ] Machine learning-based predictions
- [ ] Performance analytics dashboard
- [ ] API for external integrations

### Phase 4: User Interface
- [ ] Minimal web interface for predictions
- [ ] Real-time match tracking
- [ ] Historical data visualization
- [ ] Betting odds comparison tools

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[License information to be added]

## Support

For questions and support, please open an issue on GitHub.