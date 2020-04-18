from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
import pandas as pd
import random
import datetime
import dbConnector
import time
import json
"""
@Author: Jakob Endler
This Class is responsible for handling the interaction with HLTV
it scrapes the relevant Data and hands it over to the Database Manager
Relevant Data can be found in the "DatabaseLayout.PNG" File
"""
_UAGENT = 'Mozilla/5.0 (Linux; Android 4.4.2; en-us; SAMSUNG SM-G386T Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Version/1.6 Chrome/28.0.1500.94 Mobile Safari/537.36'


def getRawData(url, useragent=_UAGENT):
  """
  returns a bs4.soup-Object of the given url

  @Params: url: a string-url for a HLTV-Match page
  @returns a bs4.soup-Object
  """

  # User Agent Mozilla to Circumvent Security Blocking
  req = Request(url, headers={'User-Agent': useragent})

  # Connect and Save the HTML Page
  uClient = urlopen(req)
  page_html = uClient.read()
  uClient.close()

  # Parse HTML
  page_soup = soup(page_html, "html.parser")
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
  nextPage = page_soup.find("a", {"class": "pagination-next"})
  return "https://www.hltv.org" + nextPage["href"]


def remove_dupe_dicts_in_list(l):
  list_of_strings = [
      json.dumps(d, sort_keys=True)
      for d in l
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
  except:
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
    currentMap["HLTVGameID"] = int(
        map.find("a", {"href": True})["href"].split("/")[4])
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
      res.append(("https://www.hltv.org" +
                  gamelink["href"], int(gamelink["href"].split("/")[4])))
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
  page_soup = getRawData(url)
  splitted = url.split("/")
  matchID = splitted[4]
  date = _getMatchDate(page_soup)
  maps = _getMatchMaps(page_soup)
  teams = _getMatchTeams(page_soup)
  games = _getMatchGames(page_soup, matchID)
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


def getGamePlayerInfo(gameurl, matchurl, match_soup, game_soup):
  gameID = gameurl.split("/")[6]
  res = []
  playertable = match_soup.find("div", {"id": str(gameID) + "-content"})
  teamtables = playertable.find_all("table", {"class": "table totalstats"})
  try:
    assert len(teamtables) == 2
  except AssertionError as e:
    print("Invalid Teamtables | Quitting Script")
    return
  team1ID = teamtables[0].find("a", {"class": "teamName team"})[
      "href"].split("/")[2]
  team2ID = teamtables[1].find("a", {"class": "teamName team"})[
      "href"].split("/")[2]

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
      playerdict["ADR"] = playertextsplit[6]
      playerdict["HLTVrating"] = playertextsplit[8]
      res.append(playerdict)
    return remove_dupe_dicts_in_list(res)

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
    dbHandler.updateGameTable(gameDict["map"], gameDict["matchID"], gameDict["scoreTeam1"], gameDict["scoreTeam2"],
                              gameDict["link"], gameDict["HLTVID"], gameDict["individualRoundWins"])
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
    dbHandler.updateTeamsTable(matchDict["team1Name"], matchDict["team1ID"], team1PlayerString)
    dbHandler.updateTeamsTable(matchDict["team2Name"], matchDict["team2ID"], team2PlayerString)
    # Info needed for PlayerGameStatsTable
    # PlayerGameStatsTable Needed Data: playerID, gameID, kills, deaths, ADR, rating, teamID
    # The GameID-Key in the Game-Table references the sqlite-ID, thus we need to convert the HLTVID first.
    gameID = dbHandler.getGameID(gameDict["HLTVID"])
    for player in team1playerStats:
      dbHandler.updatePlayerGameStatsTable(player["playerID"], gameID, player["kills"], player["deaths"], player["ADR"], player["HLTVrating"], matchDict["team1ID"])
    for player in team2playerStats:
      dbHandler.updatePlayerGameStatsTable(player["playerID"], gameID, player["kills"], player["deaths"], player["ADR"], player["HLTVrating"], matchDict["team2ID"])


def findNewMatches():
  dbHandler = dbConnector.dbConnector()
  lastID = dbHandler.getLastMatchID()[0]
  print("Last Scraped Match found with ID: " + str(lastID))
  HLTVLINK = "https://www.hltv.org/results"
  page_soup = getRawData(HLTVLINK)
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
  print(len(res))


def updateData():
  linklist = findNewMatches()
  print(len(linklist))
  # TODO Test in HotelNET


def main():
  # updateData()
  last_match = "https://www.hltv.org/matches/2340002/livid-vs-triumph-esea-mdl-season-33-north-america"
  scrapeDataForMatch(last_match)
  # matchDict = getGeneralMatchInfo(last_match)
  # dbHandler = dbConnector.dbConnector()
  # dbHandler.updateMatchTable(matchDict["team1ID"], matchDict["team2ID"], matchDict["date"], matchDict["link"],
  #                            matchDict["HLTVID"], matchDict["team1Name"], matchDict["team2Name"], matchDict["scraped_at"])
  # for player in getGamePlayerInfo(testgame, testmatch, getRawData(testmatch), getRawData(testgame)):
  #  print(player)

  # print(getGameMaps(getRawData(testmatch2)))


if __name__ == "__main__":
  main()
