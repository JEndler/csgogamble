# @Author: Jakob Endler
# OddsScraper
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
from datetime import datetime
import json
import time
from dbConnector import dbConnector
from csgocrawler import getRawData
import logging

fmt_str = '[%(asctime)s] %(levelname)s @ %(filename)s: %(message)s'
# "basicConfig" is a convenience function, explained later
logging.basicConfig(level=logging.DEBUG, format=fmt_str, datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

def findMatchLinks(page_soup, date=datetime.today().strftime('%Y-%m-%d')):
    """finds all the match links for a given date. defaults to today.

    Args:
        page_soup (bs4.BeautifulSoup): bs4 object of the page to scrape.
        date (datetime, optional): Date to scrape matches for. Defaults to datetime.today().strftime('%Y-%m-%d').

    Returns:
        match_link_list (list): list of url strings of the matches.

    >>> findMatchLinks(getRawData("https://www.hltv.org/matches")) #doctest: +ELLIPSIS
    ['https://www.hltv.org/matches...', ...]
    """    
    match_link_list = []
    matches = page_soup.find("div", {"class": "upcomingMatchesContainer"})
    for matchday_section in matches.find_all("div", {"class": "upcomingMatchesSection"}):
        for link in matchday_section.findAll("a", {"href": True}):
            if "/matches/" in str(link["href"]):
                match_link_list.append("https://www.hltv.org" + str(link['href']))
        # return in the first loop iteration, because we only need the next day of matches
        #TODO add date check.
        return match_link_list


def analyseUpcomingMatch(url: str, scraping_window=5, save_to_file=True, path="data/upcoming_matches/") -> bool:
    """Scrapes Betting Odds for the given url. Returns True if successful, False if not. 

    Args:
        url (string): _description_
        scraping_window (int, optional): The amount of minutes a game needs to be from starting to be scraped. Defaults to 10.
        save_to_file (bool, optional): _description_. Defaults to True.
        path (str, optional): _description_. Defaults to "data/upcoming_matches".

    Returns:
        Boolean: returns True if the match was scraped successfully, meaning the match had less then 5 minutes till starting.
    """

    assert "https://www.hltv.org/matches" in url, "URL is not a valid HLTV match link."

    page_soup = getRawData(url)
    if page_soup is None:
        logger.error("Could not get page_soup for url: " + url)
        return False
    else:
        logger.info("Got raw data for " + url)

    # if there is more than an hour left for the game to start, we don't want to scrape it
    if 'h' in page_soup.find("div", {"class": "countdown"}).text: 
        logger.error("Game further than 1hr away. Aborting scraping...")
        return False

    # gets the minutes till the game starts, from the countdown element on the match page.
    try:
        minutes_till_game = int(page_soup.find("div", {"class": "countdown"}).text.split(":")[0].strip().replace("m",""))
    except ValueError:
        logger.error("Game is already live. Returning True to move on to next Game.")
        return True

    gameID = str(url.split("/")[4])
    res = {}

    # save the scraped html to file
    if save_to_file and minutes_till_game < scraping_window:
        with open(str(path + gameID + "_" + str(datetime.now()).split(" ")[0] + '.html'), 'w') as file:
            logger.info("Wrote html to file for " + url)
            file.write(str(page_soup.html))

    # if the game will start in the scraping window (5 min by default), scrape the betting odds
    if minutes_till_game < scraping_window:
        for provider in page_soup.find("div", {"class": "match-betting-list standard-box"}).find_all("tr", {"class": True}):
            try:
                odds = [provider.find_all("td")[1].text, provider.find_all("td")[3].text]
                href = provider.find("a", {"href": True})["href"]
                res[href] = odds
            except Exception as e:
                logger.error(e)

        assert len(res) > 0, "No odds found for this match."

        saveOddsToDB(res, gameID, url)
        logger.info("Wrote odds to File | GameID: " + str(gameID) + " | scraped at: " + str(datetime.now()))
        return True
    logger.info("Game will start in " + str(minutes_till_game) + " minutes. Aborting scraping...")
    return False


def saveOddsToDB(odds: dict, gameID: str, url: str) -> None:
    """takes a dictionary of odds and saves them to the database.

    Args:
        odds (dictionary): dictionary of odds to save, the key is the betting provider link.
        gameID (string): string of the (numeric) gameID.
        url (string): url of the match.
    """
    db = dbConnector()
    for key in odds.keys():
        db.updateOddsTable(gameID, url, key, odds[key][0], odds[key][1])


def main():
    _HLTV_MATCHES = "https://www.hltv.org/matches"
    for link in findMatchLinks(getRawData(_HLTV_MATCHES)):
        # If analyseUpcomingMatch returns True, the match was scraped successfully.
        # Otherwise the game is more then 5 minutes away. Scraping will be aborted.
        if not analyseUpcomingMatch(link): return

if __name__ == "__main__":
    logger.info("Starting scraping at: " + str(datetime.now()))
    main()
