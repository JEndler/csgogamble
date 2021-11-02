# @Author: Jakob Endler
# OddsScraper
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
from datetime import datetime
import json
import time
from csgocrawler import getRawData

def findMatchLinks(page_soup, date=None):
    match_link_list = []
    matchday = page_soup.find("div", {"class": "upcoming-matches"})
    matchday = page_soup.find("div", {"class": "upcomingMatchesContainer"})
    for link in matchday.findAll("a", {"href": True}):
        if "/matches/" in str(link["href"]):
            match_link_list.append("https://www.hltv.org" + str(link['href']))
    return match_link_list


def analyseUpcomingMatch(url):
    OUTDATED_BETTING_PROVIDERS = ["ggbet-odds gprov_ggbet betting_provider",
                                  " gprov_betway betting_provider",
                                  " gprov_lootbet betting_provider",
                                  " gprov_egb betting_provider",
                                  "thunderpick-odds gprov_thunderpick betting_provider",
                                  " gprov_bet365 betting_provider"]
    _BETTING_PROVIDERS = [" gprov_gv4nx914 provider",
                          " gprov_p2g0jzml provider",
                          " gprov_nz6cnayl provider",
                          " gprov_egb provider",
                          " thunderpick-odds gprov_thunderpick provider",
                          " gprov_3etkx6rj provider"]
    _BETTING_PROVIDER_NAMES = ["gg.bet", "betway", "loot.bet", "egb", "thunderpick", "bet365"]
    page_soup = getRawData(url)
    time = page_soup.find("div", {"class": "time"})
    currentTime = str(datetime.now())
    currentHour = currentTime.split(" ")[1]
    currentHour = int(currentHour.split(":")[0])
    currentMin = int(currentTime.split(":")[-2])
    # Convert to Total Min for easy comparison
    currentMin += currentHour * 60
    gameHour = int(time.text.split(":")[0])
    gameMin = int(time.text.split(":")[1]) + int(gameHour * 60)
    timeTillGame = gameMin - currentMin
    gameID = str(url.split("/")[4])
    res = {}
    res["gameID"] = gameID
    res["scrapedAt"] = str(datetime.now())
    if timeTillGame < 40:
        for provider in _BETTING_PROVIDERS:
            row = page_soup.find("tr", {"class": provider})
            if row is None:
                row = page_soup.find("tr", {"class": provider.strip()})
            if row is None: continue
            #with open("notes/temp.html", "w") as tmpfile:
            #    tmpfile.write(page_soup.prettify())
            odds = (row.text.strip().replace("\n", "").split("-"))
            providerName = _BETTING_PROVIDER_NAMES[_BETTING_PROVIDERS.index(provider)]
            try:
                assert len(odds) == 2
                assert str(odds[0]).replace(".", "").isdigit()
                assert str(odds[1]).replace(".", "").isdigit()
                res[str(_BETTING_PROVIDER_NAMES[_BETTING_PROVIDERS.index(provider)])] = (odds[0], odds[1])
            except AssertionError:
                #print("No Odds Data for Provider: " + providerName + " with GameID: " + str(gameID))
        writeOddsToFile(res)
        print("Wrote odds to File | GameID: " + str(gameID) + " | scraped at: " + str(datetime.now()))


def writeOddsToFile(resdict):
    with open("/home/projects/csgogamble/data/odds.txt", "a", encoding='utf-8') as oddsfile:
        oddsfile.write("\n" + str(json.dumps(resdict)))
    cleanupOddsfile()


def cleanupOddsfile():
    with open("data/odds.txt", "r", encoding='utf-8') as oddsfile:
        lines = oddsfile.readlines()
    count = {}
    for line in lines:
        if line in ["", '\n']:
            lines.remove(line)
            continue
        tmpdict = json.loads(line)
        if tmpdict["gameID"] in count.keys():
            count[tmpdict["gameID"]] += 1
        else:
            count[tmpdict["gameID"]] = 1
    for line in lines:
        gameID = line.split('"')[3]
        if count[gameID] == 1:
            continue
        lines.remove(line)
        count[gameID] -= 1
    with open("data/odds.txt", "w", encoding='utf-8') as oddsfile:
        oddsfile.writelines(lines)

def loadOdds(filepath="data/odds.txt"):
    cleanupOddsfile()
    odds = []
    with open(filepath, 'r') as oddsfile:
        for line in oddsfile:
            odds.append(json.loads(line))
    return odds

def main():
    _HLTV_MATCHES = "https://www.hltv.org/matches"
    for link in findMatchLinks(getRawData(_HLTV_MATCHES)):
        analyseUpcomingMatch(link)


if __name__ == "__main__":
    main()
