# @Author: Jakob Endler
# OddsScraper - Minimal version for single URL
from bs4 import BeautifulSoup as soup
from datetime import datetime
from scraper.crawler import getRawData
import logging
import sys
import os
from pathlib import Path

fmt_str = '[%(asctime)s] %(levelname)s @ %(filename)s: %(message)s'
logging.basicConfig(level=logging.DEBUG, format=fmt_str, datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)


def saveHtmlToFile(html_content: str, game_id: str, storage_type: str = "local") -> str:
    """Save HTML content to file or cloud storage.
    
    Args:
        html_content (str): Raw HTML content to save
        game_id (str): Game ID for file naming
        storage_type (str): 'local' for file system, 'r2' for Cloudflare R2 (future)
    
    Returns:
        str: Path/URL where the file was saved
    """
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"{game_id}_{timestamp}.html"
    
    if storage_type == "local":
        # Create directory if it doesn't exist
        html_dir = Path("storage/html")
        html_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = html_dir / filename
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        logger.info(f"HTML saved to: {file_path}")
        return str(file_path)
    
    elif storage_type == "r2":
        # TODO: Implement Cloudflare R2 upload
        # This would involve:
        # 1. Configure R2 credentials
        # 2. Upload file to R2 bucket
        # 3. Return R2 URL
        logger.warning("R2 storage not yet implemented, falling back to local")
        return saveHtmlToFile(html_content, game_id, "local")
    
    else:
        raise ValueError(f"Unknown storage type: {storage_type}")


def scrapeMatchOdds(url: str, save_html: bool = False, storage_type: str = "local") -> dict:
    """Scrapes betting odds for a single HLTV match URL.

    Args:
        url (str): HLTV match URL
        save_html (bool): Whether to save the raw HTML
        storage_type (str): Where to save HTML ('local' or 'r2')

    Returns:
        dict: Dictionary containing betting odds from different providers
    """

    assert "https://www.hltv.org/matches" in url, "URL is not a valid HLTV match link."
    gameID = str(url.split("/")[4])

    page_soup = getRawData(url)
    if page_soup is None:
        logger.error("Could not get page_soup for url: " + url)
        return {}
    else:
        logger.info("Got raw data for " + url)
        
        # Save HTML if requested
        if save_html:
            try:
                html_content = str(page_soup)
                saved_path = saveHtmlToFile(html_content, gameID, storage_type)
                logger.info(f"Raw HTML saved to: {saved_path}")
            except Exception as e:
                logger.error(f"Failed to save HTML: {e}")

    # Check if game is live or upcoming
    countdown_elem = page_soup.find("div", {"class": "countdown"})
    if countdown_elem and 'h' in countdown_elem.text:
        logger.info("Game is more than 1 hour away")
    elif countdown_elem:
        try:
            minutes_till_game = int(countdown_elem.text.split(":")[0].strip().replace("m",""))
            logger.info(f"Game starts in {minutes_till_game} minutes")
        except ValueError:
            logger.info("Game is already live")

    odds = {}
    
    try:
        betting_section = page_soup.find("div", {"class": "match-betting-list standard-box"})
        if betting_section:
            for provider in betting_section.find_all("tr", {"class": True}):
                try:
                    tds = provider.find_all("td")
                    if len(tds) >= 4:
                        provider_name_elem = tds[0].find("img")
                        if provider_name_elem and provider_name_elem.get("alt"):
                            provider_name = provider_name_elem["alt"]
                        else:
                            provider_name = tds[0].get_text(strip=True) or "Unknown Provider"
                        
                        odds_1 = tds[1].get_text(strip=True)
                        odds_2 = tds[3].get_text(strip=True)
                        
                        if odds_1 and odds_2:
                            odds[provider_name] = [odds_1, odds_2]
                except Exception as e:
                    continue
        else:
            logger.info("No betting odds section found")
    except Exception as e:
        logger.error(f"Error scraping odds: {e}")
    
    return odds



def main():
    if len(sys.argv) < 2:
        print("Usage: python OddsScraper.py <HLTV_MATCH_URL> [--save-html] [--storage=local|r2]")
        print("Options:")
        print("  --save-html    Save raw HTML to storage")
        print("  --storage=TYPE Storage type: 'local' (default) or 'r2' (Cloudflare R2)")
        sys.exit(1)
    
    url = sys.argv[1] 
    save_html = "--save-html" in sys.argv
    
    # Parse storage type
    storage_type = "local"
    for arg in sys.argv:
        if arg.startswith("--storage="):
            storage_type = arg.split("=")[1]
            break
    
    logger.info(f"Scraping odds for: {url}")
    if save_html:
        logger.info(f"HTML will be saved using {storage_type} storage")
    
    odds = scrapeMatchOdds(url, save_html=save_html, storage_type=storage_type)
    
    if odds:
        print(f"\nFound odds from {len(odds)} providers:")
        for provider, odds_data in odds.items():
            print(f"{provider:<20} | {odds_data[0]:>6} vs {odds_data[1]:<6}")
    else:
        print("No odds found for this match")

if __name__ == "__main__":
    main()
