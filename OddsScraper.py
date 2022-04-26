# @Author: Jakob Endler
# OddsScraper
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
from datetime import datetime
import json
import time
from dbConnector import dbConnector
from numpy import logspace
from csgocrawler import getRawData

#TODO add logging.

def findMatchLinks(page_soup, date=datetime.today().strftime('%Y-%m-%d')):
    match_link_list = []
    matches = page_soup.find("div", {"class": "upcomingMatchesContainer"})
    for matchday_section in matches.find_all("div", {"class": "upcomingMatchesSection"}):
        for link in matchday_section.findAll("a", {"href": True}):
            if "/matches/" in str(link["href"]):
                match_link_list.append("https://www.hltv.org" + str(link['href']))
        # return in the first loop iteration, because we only need the next day of matches
        #TODO add date check.
        return match_link_list


def analyseUpcomingMatch(url, scraping_window=10, save_to_file=True, path="data/upcoming_matches/"):
    """_summary_

    Args:
        url (_type_): _description_
        scraping_window (int, optional): _description_. Defaults to 5.
        save_to_file (bool, optional): _description_. Defaults to True.
        path (str, optional): _description_. Defaults to "data/upcoming_matches".

    Returns:
        Boolean: returns True if the match was scraped successfully, meaning the match had less then 5 minutes till starting.
    """
    page_soup = getRawData(url)

    # if there is more than an hour left for the game to start, we don't want to scrape it
    if 'h' in page_soup.find("div", {"class": "countdown"}).text: return False
    
    # gets the minutes till the game starts, from the countdown element on the match page.
    minutes_till_game = int(page_soup.find("div", {"class": "countdown"}).text.split(":")[0].strip().replace("m",""))
    
    gameID = str(url.split("/")[4])
    res = {}

    # save the scraped html to file
    if save_to_file and minutes_till_game < scraping_window:
        with open(str(path + gameID + "_" + str(datetime.now()).split(" ")[0] + '.html'), 'w') as file:
            file.write(str(page_soup.html))

    # if the game will start in the next 5 minutes, scrape the betting odds
    if minutes_till_game < scraping_window:
        for provider in page_soup.find("div", {"class": "match-betting-list standard-box"}).find_all("tr", {"class": True}):
            try:
                odds = [provider.find_all("td")[1].text, provider.find_all("td")[3].text]
                href = provider.find("a", {"href": True})["href"]
                res[href] = odds
            except Exception as e:
                print(e)

        saveOddsToDB(res, gameID, url)
        print("Wrote odds to File | GameID: " + str(gameID) + " | scraped at: " + str(datetime.now()))
        return True


def saveOddsToDB(odds, gameID, url):
    db = dbConnector()
    for key in odds.keys():
        db.updateOddsTable(gameID, url, key, odds[key][0], odds[key][1])


def main():
    _HLTV_MATCHES = "https://www.hltv.org/matches"
    for link in findMatchLinks(getRawData(_HLTV_MATCHES)):
        if analyseUpcomingMatch(link) == False:
            print("Match will start in more than 5 minutes | GameID: " + str(link.split("/")[4]))
            print("Aborting scraping... restarting in 5 minutes")
            break

if __name__ == "__main__":
    print("Starting scraping at: " + str(datetime.now()))
    main()
