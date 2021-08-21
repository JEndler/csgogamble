from requests import request, get
from bs4 import BeautifulSoup as soup
import pandas as pd
import datetime
import dbConnector
import time
import json
import proxyManager as pM
import sys
import cfscrape
"""
@Author: Jakob Endler
This Class is responsible for handling the interaction with HLTV
it scrapes the relevant Data and hands it over to the Database Manager
Relevant Data can be found in the "DatabaseLayout.PNG" File
"""
_UAGENT = '''Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36'''

# proxy.txt needs to contain NordVPN Proxy Username and Password
# try:
#     with open("proxy.txt", "r") as proxyfile:
#         s = proxyfile.readline().split(";")
#         PROXY_USR, PROXY_PW = s[0].strip(), s[1].strip()
#     print(str("https://" + PROXY_USR + ":" + PROXY_PW + "@de867.nordvpn.com"))
# except Exception:
#     PROXY_USR, PROXY_PW = None, None
proxies = pM.ProxyManager(validateProxies=False)
use_proxy = False


def getRawData(url, useragent=_UAGENT, waittime=16, crawl_delay=30):
    """
    returns a bs4.soup-Object of the given url

    @Params: 
        url: a string-url for a HLTV-Match page
        waittime: default waittime after encountering a HTTP429 Error
        proxy: Bool to use proxy or not
        crawl_delay: default delay after each request
    @returns a bs4.soup-Object
    """
    try:
        # Connect and Save the HTML Page
        # Check if Proxy Settings are available
        # User Agent Mozilla to Circumvent Security Blocking
        request = "GET / HTTP/1.1\r\n"

        cookie_value, user_agent = cfscrape.get_cookie_string(url)
        print(cookie_value)
        headers = {'user-agent': useragent}

        if use_proxy:
            page_html = proxies.proxiedRequest(url)

            while 'DDoS protection' in str(page_html):
                # if Cloudflare blocks the Proxy, try another one
                print("Another one")
                page_html = proxies.proxiedRequest(url)
        else:
            page_html = get(url).text
            if 'DDoS protection' in str(page_html):
                cookie_value, user_agent = cfscrape.get_cookie_string(url)
                print(cookie_value)
    except Exception as e:
        print(e)
        print("HTTPError 429 Too many requests, waiting for " + str(waittime) + " Seconds.")
        time.sleep(waittime)
        return getRawData(url, waittime=waittime * 2)

    # Parse HTML
    page_soup = soup(page_html, "html.parser")
    time.sleep(crawl_delay)
    return page_soup


def findMatchLinks(page_soup):
    """
    This is a helper Method that returns a list of all Match-Links
    in a given HLTV-Page.

    @Params: page_soup: a bs4.soup-Object of a HLTV.org Page
    @returns a list of Match-Links
    """
    match_link_list = []
    result_holder = page_soup.findAll("div", {"class": "results-holder"})
    result = []
    for body in result_holder:
        result.extend(body.findAll("a", {'href': True}))
    for link in result:
        href = str(link['href'])
        if "/matches/" in href:
            match_link_list.append("https://www.hltv.org" + href)
    return match_link_list


def findLinkToNextPage(page_soup):
    print(page_soup)
    if 'DDoS protection' in str(page_html):
        print("Yeet")
    nextPage = page_soup.find("a", {"class": "pagination-next"})
    print(nextPage)
    return "https://www.hltv.org" + nextPage["href"]


def remove_dupe_dicts_in_list(pList):
    list_of_strings = [
        json.dumps(d, sort_keys=True)
        for d in pList
    ]
    list_of_strings = set(list_of_strings)
    return [
        json.loads(s)
        for s in list_of_strings
    ]


def month_string_to_number(string):
    """ Takes a month string and returns a number """
    m = {
        'jan': 1,
        'feb': 2,
        'mar': 3,
        'apr': 4,
        'may': 5,
        'jun': 6,
        'jul': 7,
        'aug': 8,
        'sep': 9,
        'oct': 10,
        'nov': 11,
        'dec': 12
    }
    s = string.strip()[:3].lower()

    try:
        out = m[s]
        return out
    except Exception:
        raise ValueError('Not a month')


def _getMatchDate(page_soup):
    """
    returns relevant Date Information for a given soup_Object

    @Params: page_soup: bs4.soup-Object of an HTLV-Result Page
    @returns a datetime.datetime Object
    """
    time = page_soup.find("div", {"class": "time"}).text
    date = page_soup.find("div", {"class": "date"}).text
    year = date[-4:]
    day = int((date.split(" ")[0])[0:-2])
    month = month_string_to_number(date.split(" ")[2])
    return datetime.datetime(int(year), month, int(day), hour=int(time.split(":")[0]), minute=int(time.split(":")[1]))


def _getMatchMaps(page_soup):
    """
    returns Data on the Maps played

    @Params: page_soup: bs4.soup-Object of an HTLV-Result Page
    @returns a list of Dictionaries formatted like this:
     {"mapname":"Inferno","HLTVGameID":7613, "scoreTeam1":16, scoreTeam2:8}
    """
    result = []
    maps = page_soup.findAll("div", {"class": "mapholder"})
    for map in maps:
        currentMap = {}
        if map.find("div", {"class": "played"}) is None:
            continue
        if map.find("div", {"class": "mapname"}).text == "Default":
            continue
        currentMap["mapname"] = (map.find("div", {"class": "mapname"}).text)
        currentMap["HLTVGameID"] = int(map.find("a", {"href": True})["href"].split("/")[4])
        # if map.find("span", {"class": "won"}) is None:
        #   currentMap["scoreTeam1"] = 15
        #   currentMap["scoreTeam2"] = 15
        #   continue
        # This scrapes the scores of each Team per Map
        for results_holder in map.findAll("div", {"class": "results"}):
            if results_holder is None:
                continue
            results = results_holder.findAll("div", {"class": "results-team-score"})
            if results[0].text.isdigit():
                currentMap["scoreTeam1"] = int(results[0].text)
            if results[1].text.isdigit():
                currentMap["scoreTeam2"] = int(results[1].text)
        result.append(currentMap)
    return result


def _getMatchTeams(page_soup):
    """
    returns Data on the Teams present in the Game

    @Params: page_soup: bs4.soup-Object of an HTLV-Result Page
    @returns a Dictionary formatted like this:
    {"team1ID":team1ID,"team2ID":team2ID,"team1name":team1Name,"team2name":team2Name}
    """
    team1 = page_soup.find("div", {"class": "team1-gradient"})
    team2 = page_soup.find("div", {"class": "team2-gradient"})
    team1Name = team1.find("div", {"class": "teamName"}).text
    team2Name = team2.find("div", {"class": "teamName"}).text
    teamhrefs = page_soup.find_all("tr", {"class": "header-row"})
    teamIDs = []
    team1ID = None
    team2ID = None
    i = 0
    for teamhref in teamhrefs:
        i += 1
        link = teamhref.find("a", {"href": True})
        if link is not None:
            linklist = str(link).split("/")
            if linklist[2] in teamIDs:
                continue
            teamIDs.append(linklist[2])
            if i == 1:
                team1ID = linklist[2]
            else:
                team2ID = linklist[2]
    res = {
        "team1ID": team1ID,
        "team2ID": team2ID,
        "team1name": team1Name,
        "team2name": team2Name}
    return res


def _getGameRoundHistory(page_soup):
    """
    Returns the Individual Round Wins for a given Game

    @Params: page_soup of an "mapstatsid"-HLTV Page
    @returns: a list of round wins formatted like this:
    [1,2,1,1,1,2,1...] 1 or 2 for the individual Teams
    """
    round_history_holder = page_soup.find(
        "div", {"class": "standard-box round-history-con"})
    if round_history_holder is None:
        return -1  # invalid page_soup
    result = []
    for element in round_history_holder.find_all("img", {"class": "round-history-outcome"}, {"title": True}):
        title = element["title"]
        if title != "":
            result.append(title)

    # custom key-function to sort the generated List
    def _compareRoundHistory(element):
        return int(element.split("-")[0]) + int(element.split("-")[-1])

    return(sorted(result, key=_compareRoundHistory))


def _getMatchGames(page_soup, HLTVmatchID):
    """
    Returns a List of Dictionaries for every Game in a given Match
    The Dictionaries is formatted as follows:
    {"GameLink":"link","HLTVGameID":91571,"Map":Inferno,"ScoreTeam1":16, "ScoreTeam2":8}
    """
    res = []
    for gamelink in page_soup.find_all("a", {"href": True}):
        if "mapstatsid" in str(gamelink["href"]):
            res.append(("https://www.hltv.org" + gamelink["href"], int(gamelink["href"].split("/")[4])))
    maps = _getMatchMaps(page_soup)
    for game in maps:
        game["matchID"] = HLTVmatchID
        for tupl in res:
            if tupl[1] == game["HLTVGameID"]:
                game["link"] = tupl[0]
    return maps


def _getKillMatrices(page_soup):
    """
    TODO: Map Player Names to PlayerIDs
    """
    html = str(page_soup)
    df = pd.read_html(html, header=0)[1]
    return df


def _getGamePlayerStats(page_soup, HLTVgameID):
    """
    gameID is the HTLV-Game-ID found in the "detailed Statistics Link"
    """
    gamepage = page_soup.find_all("a", {"href": True})
    for link in gamepage:
        if str(HLTVgameID) in link["href"]:
            gamepage = link["href"]
            break
    page_soup = getRawData("https://www.hltv.org" + gamepage)
    print(page_soup)


def getGeneralMatchInfo(url):
    """
    @Params: url of a HLTV.org Match-Page
    @returns a Dictionary containing all necessary Data for the Match-Table
    """
    page_soup = getRawData(url)
    splitted = url.split("/")
    matchID = splitted[4]
    date = _getMatchDate(page_soup)
    teams = _getMatchTeams(page_soup)
    matchDict = {
        "HLTVID": matchID,
        "date": date,
        "team1ID": teams["team1ID"],
        "team2ID": teams["team2ID"],
        "team1Name": teams["team1name"],
        "team2Name": teams["team2name"],
        "scraped_at": datetime.datetime.now(),
        "link": url
    }
    return matchDict


def getGeneralGameInfo(gameurl, matchurl, match_soup):
    page_soup = getRawData(gameurl)
    splitted = gameurl.split("/")
    gameID = splitted[6]
    matchID = matchurl.split("/")[4]
    maps = _getMatchMaps(match_soup)
    for mapdict in maps:
        if str(mapdict["HLTVGameID"]) == str(gameID):
            maps = mapdict
            break
    roundwins = _getGameRoundHistory(page_soup)
    killmatrix = _getKillMatrices(page_soup)
    gameDict = {
        "HLTVID": gameID,
        "matchID": matchID,
        "map": maps["mapname"],
        "scoreTeam1": maps["scoreTeam1"],
        "scoreTeam2": maps["scoreTeam2"],
        "individualRoundWins": str(roundwins),
        "link": gameurl,
        "killmatrix": killmatrix
    }
    return gameDict


def _analyseTeamTable(page_soup, teamID):
    res = []
    for playerrow in page_soup.find_all("tr"):
        playerdict = {}
        playertextsplit = playerrow.text.strip().split("\n")
        if playertextsplit[1] == '':
            continue
        playerdict["playerID"] = str(playerrow.find(
            "a", {"href": True})["href"]).split("/")[2]
        playerdict["playerName"] = playertextsplit[1]
        playerdict["kills"] = playertextsplit[4].split("-")[0]
        playerdict["deaths"] = playertextsplit[4].split("-")[1]
        if len(playertextsplit) > 7:
            playerdict["ADR"] = playertextsplit[6]
            playerdict["HLTVrating"] = playertextsplit[8]
        else:
            playerdict["ADR"] = -1
            playerdict["HLTVrating"] = -1
        res.append(playerdict)
    return remove_dupe_dicts_in_list(res)


def getGamePlayerInfo(gameurl, matchurl, match_soup, game_soup):
    gameID = gameurl.split("/")[6]
    playertable = match_soup.find("div", {"id": str(gameID) + "-content"})
    teamtables = playertable.find_all("table", {"class": "table totalstats"})
    try:
        assert len(teamtables) == 2
    except AssertionError:
        print("Invalid Teamtables | Quitting Script")
        return
    team1ID = teamtables[0].find("a", {"class": "teamName team"})[
        "href"].split("/")[2]
    team2ID = teamtables[1].find("a", {"class": "teamName team"})[
        "href"].split("/")[2]

    team1playerStats = _analyseTeamTable(teamtables[0], team1ID)
    team2playerStats = _analyseTeamTable(teamtables[1], team2ID)
    return gameID, team1ID, team2ID, team1playerStats, team2playerStats


def scrapeDataForMatch(url):
    """
    Scrapes all relevant Data for a given Match-Url &
    writes it to the SQLite-Database
    """
    dbHandler = dbConnector.dbConnector()
    # Info needed for Matchtable
    # Needed Data: date, HLTVID, team1ID, team2ID, scraped_at, link
    matchDict = getGeneralMatchInfo(url)
    dbHandler.updateMatchTable(matchDict["team1ID"], matchDict["team2ID"], matchDict["date"],
                               matchDict["link"], matchDict["HLTVID"], matchDict["scraped_at"])
    # Info needed for Gametable
    # Needed Data: map, matchID, scoreTeam1, scoreTeam2, individualRoundWins, link, killmatrix, HLTVID
    match_soup = getRawData(url)
    for game in _getMatchGames(match_soup, matchDict["HLTVID"]):
        gameDict = getGeneralGameInfo(game["link"], url, match_soup)
        # Info needed for PlayersTable
        # PlayersTable Needed Data: HLTVID, playerName
        gameID, team1ID, team2ID, team1playerStats, team2playerStats = getGamePlayerInfo(
            game["link"], url, match_soup, getRawData(game["link"]))
        for player in (team1playerStats + team2playerStats):
            dbHandler.updatePlayerTable(player["playerID"], player["playerName"])
        # Info needed for TeamsTable
        # TeamsTable Needed Data: TeamName, HLTVID, playerString(see Comment below)
        # This outputs a SORTED, ";"-divided String with every Player in a Team
        team1PlayerString = ";".join([str(playerID) for playerID in sorted(
            [int(player["playerID"]) for player in team1playerStats])])
        team2PlayerString = ";".join([str(playerID) for playerID in sorted(
            [int(player["playerID"]) for player in team2playerStats])])
        dbHandler.updateGameTable(gameDict["map"], gameDict["matchID"], gameDict["scoreTeam1"], gameDict["scoreTeam2"],
                                  gameDict["link"], gameDict["HLTVID"], individualRoundWins=gameDict["individualRoundWins"],
                                  team1IDs=team1PlayerString, team2IDs=team2PlayerString)
        dbHandler.updateTeamsTable(matchDict["team1Name"], matchDict["team1ID"], team1PlayerString)
        dbHandler.updateTeamsTable(matchDict["team2Name"], matchDict["team2ID"], team2PlayerString)
        # Info needed for PlayerGameStatsTable
        # PlayerGameStatsTable Needed Data: playerID, gameID, kills, deaths, ADR, rating, teamID
        # The GameID-Key in the Game-Table references the sqlite-ID, thus we need to convert the HLTVID first.
        gameID = dbHandler.getGameID(gameDict["HLTVID"])
        for player in team1playerStats:
            dbHandler.updatePlayerGameStatsTable(player["playerID"], gameID, player["kills"], player["deaths"],
                                                 player["ADR"], player["HLTVrating"], matchDict["team1ID"])
        for player in team2playerStats:
            dbHandler.updatePlayerGameStatsTable(player["playerID"], gameID, player["kills"], player["deaths"],
                                                 player["ADR"], player["HLTVrating"], matchDict["team2ID"])


def findNewMatches():
    """
    @Params: None
    @returns a list of HLTV-Match-Links for every Match thats not yet in the Database
    """
    dbHandler = dbConnector.dbConnector()
    lastID = dbHandler.getLastMatchID()[0]
    if lastID is None:
        lastID = 2328088
    # Load all Matches sarting at November 2018
    # https://www.hltv.org/matches/2328088/astralis-vs-north-esl-pro-league-season-8-europe
    print("Last Scraped Match found with ID: " + str(lastID))
    HLTVLINK = "https://www.hltv.org/results"
    page_soup = getRawData(HLTVLINK)
    assert page_soup is not None, "Page HTML didnt load, aborting..."
    res = []
    while True:
        for matchlink in findMatchLinks(page_soup):
            matchID = matchlink.split("/")[4]
            if str(matchID) == str(lastID):
                return res
            res.append(matchlink)
        nextpage = findLinkToNextPage(page_soup)
        print("Analysing Match No:" + str(len(res)))
        page_soup = getRawData(nextpage)
        return res


def updateData():
    """
    This Method uses all the other Methods to update the Database
    This should ideally be run hourly or daily.
    """
    linklist = findNewMatches()
    linklist = linklist[::-1]
    counter = 0
    print("Discovering Matches done, starting the Download...")
    print("Found " + str(len(linklist)) + " Matches to download, estimated Time to finish: " + str(0.5 * len(linklist)) + "min")
    for link in linklist:
        print("Scraping Match No:" + str(counter) + " | Link: " + link)
        try:
            scrapeDataForMatch(link)
        except Exception as e:
            raise e
        counter += 1


def main():
    if use_proxy: proxies.proxy_list = proxies._checkSavedProxies()
    starttime = datetime.datetime.now()
    updateData()
    timedelta = datetime.datetime.now() - starttime
    print("The Webscraper took: " + str(int(timedelta.total_seconds() / 60)) + " Minutes to complete.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--use-proxy": use_proxy = True 
    main()
