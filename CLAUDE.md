# CS2 HLTV Scraper - Development Guidelines

This document outlines the coding standards, project structure, and development workflow for the CS2 HLTV Scraper project.

## Project Overview

A Cloudflare-native scraping system for CS2 match data and betting odds, serving as a learning opportunity for Cloudflare-centric architecture patterns.

## Python Code Standards

### Type Hints & Annotations
- **Strict typing required**: All function parameters and return types must have type hints
- **No Union syntax**: Use `Union[str, int]` instead of `str | int` 
- **Forward references**: Use `from __future__ import annotations` when needed

```python
from typing import Dict, List, Optional, Union
from datetime import datetime

def scrape_match_odds(url: str, save_html: bool = False) -> Dict[str, List[str]]:
    """Scrape betting odds for a single HLTV match URL."""
    pass
```

### Code Formatting & Style
- **Formatter**: Black with default settings
- **Line length**: No strict limit (long lines are acceptable for readability)
- **Import sorting**: isort for consistent import organization
- **Docstring style**: Google format

```python
def example_function(param1: str, param2: int) -> Optional[str]:
    """Example function demonstrating Google-style docstrings.
    
    Args:
        param1: Description of first parameter.
        param2: Description of second parameter.
        
    Returns:
        Optional string result or None if processing fails.
        
    Raises:
        ValueError: If param2 is negative.
    """
    pass
```

### Linting & Quality
- **Linter**: Ruff for fast, comprehensive linting
- **CI Standards**: Builds must fail on any warnings (post-v1 scaffolding)
- **Type checking**: mypy for static type analysis

### Python Version
- **Minimum**: Python 3.11+ (use latest stable features)
- **Dependency management**: Poetry with exact version pinning

## Project Structure

### Current Development Structure
```
csgo-scraper/
├── OddsScraper.py          # Minimal odds scraper
├── csgocrawler.py          # Core scraping utilities  
├── dbConnector.py          # Database connections
├── proxyManager.py         # Proxy rotation
├── data/                   # Local data storage
├── docs/                   # Project documentation
├── pyproject.toml          # Poetry configuration
└── CLAUDE.md              # This file
```

### Target Production Structure
```
csgo-scraper/
├── container/              # Python scraping container
│   ├── Dockerfile         # Simple, single-stage build
│   ├── requirements.txt   # Container dependencies
│   └── src/               # Python source code
├── worker/                # Cloudflare Worker code
│   ├── src/               # TypeScript/JavaScript
│   ├── wrangler.toml      # Worker configuration
│   └── package.json       # Node dependencies
├── database/              # D1 schema and migrations
├── docs/                  # Service documentation
└── .github/workflows/     # GitHub Actions
```

## Dependency Management

### Poetry Configuration
- **Dependency groups**: Use `[tool.poetry.group.dev.dependencies]` for development tools
- **Version pinning**: Exact versions for reproducible builds
- **Python version**: `python = "^3.11"`

### Example pyproject.toml structure:
```toml
[tool.poetry.group.dev.dependencies]
black = "23.x.x"
ruff = "0.x.x"
mypy = "1.x.x"
```

## Git & GitHub Workflow

### Repository Management
- **Branching**: Feature branches with descriptive names
- **Merge strategy**: Squash merges to main branch
- **Protection**: Minimal branch protection (hobby project flexibility)

### Commit Standards
- **Format**: Conventional commits preferred but not enforced
- **Squash merges**: Keep main branch history clean

### GitHub Actions Workflows
- **Code Quality**: Ruff linting + mypy type checking on PRs
- **Container Builds**: Docker image builds for container changes
- **Cloudflare Deployment**: Automated deployment via Wrangler
- **Dependency Security**: Dependabot for vulnerability scanning

## Cloudflare Development

### Local Development Setup
- **Worker testing**: `wrangler dev` for local miniflare environment
- **Database**: Local D1 with `wrangler d1 execute` for schema management
- **Storage**: R2 dev bucket or local emulation for file operations
- **Configuration**: KV local storage for development settings

### Deployment Pipeline
- **Tool**: Wrangler for all Cloudflare deployments
- **Environments**: dev/staging/prod configurations
- **Secrets**: GitHub Secrets → Cloudflare via GitHub Actions
- **Configuration**: Environment-specific wrangler.toml files

### Architecture Principles
- **Edge-first**: Leverage Cloudflare's global network
- **Serverless**: Workers for orchestration, containers for heavy processing
- **Cost-effective**: Optimize for Cloudflare's pricing model
- **Learning-focused**: Explore Cloudflare-native patterns

## Logging & Monitoring

### Logging Standards
- **Format**: Structured JSON logging for easy parsing
- **Levels**: DEBUG, INFO, WARN, ERROR with appropriate usage
- **Context**: Include relevant metadata (match_id, timestamp, etc.)

```python
import logging
import json
from datetime import datetime

logger = logging.getLogger(__name__)

def log_scraping_event(match_id: str, status: str, details: dict) -> None:
    """Log structured scraping events."""
    log_data = {
        "timestamp": datetime.utcnow().isoformat(),
        "match_id": match_id,
        "status": status,
        "details": details
    }
    logger.info(json.dumps(log_data))
```

### Error Handling
- **Graceful degradation**: Continue processing on non-critical errors
- **Retry logic**: Implement exponential backoff for transient failures
- **Monitoring ready**: Structure logs for future alerting systems

## Documentation

### Code Documentation
- **Docstrings**: Google format for all public functions and classes
- **Type hints**: Comprehensive typing for self-documenting code
- **Comments**: Explain "why" not "what" in code comments

### Project Documentation
- **Location**: `/docs/` folder for all major documentation
- **Structure**: 
  - `architecture.md` - System design decisions
  - `deployment.md` - Deployment procedures
  - `api.md` - Container API documentation
  - `cloudflare.md` - Cloudflare service configurations

### Service Documentation
- **Decision records**: Document major architectural decisions
- **API specs**: Clear endpoint documentation for container services
- **Configuration guides**: Setup instructions for each Cloudflare service

## Development Phases

### Phase 1: Foundation (Current)
- ✅ Single-URL scraper with clean output
- ✅ HTML snapshot functionality
- 🚧 Code quality tooling setup
- 🚧 Project structure reorganization

### Phase 2: Cloudflare Migration
- [ ] Container packaging and deployment
- [ ] Worker development and deployment
- [ ] D1 database migration
- [ ] R2 storage integration

### Phase 3: Production Features  
- [ ] Automated scheduling and monitoring
- [ ] Advanced error handling and retry logic
- [ ] Performance optimization
- [ ] Comprehensive logging and alerting

## Quality Gates

### Pre-commit Requirements
- [ ] Black formatting applied
- [ ] Ruff linting passes
- [ ] Type hints present on all functions
- [ ] Docstrings on public APIs

### CI/CD Requirements
- [ ] All linting checks pass
- [ ] Type checking passes
- [ ] Container builds successfully
- [ ] Worker deploys without errors

## Learning Objectives

This project serves as hands-on learning for:
- **Cloudflare Workers**: Serverless compute at the edge
- **Cloudflare D1**: Global SQLite database
- **Cloudflare R2**: Object storage
- **Cloudflare KV**: Key-value storage
- **Modern Python practices**: Type hints, structured logging, containerization
- **CI/CD pipelines**: GitHub Actions with Cloudflare integration

---

*This document is a living guide and should be updated as the project evolves and new patterns emerge.*