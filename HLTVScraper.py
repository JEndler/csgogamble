from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
import pandas as pd
import EloHandler
import random

HLTV_MATCHES_LINK = "https://www.hltv.org/results/"

TIE_GAME_URL_DEBUGGING = "https://www.hltv.org/matches/2323934/valiance-vs-illuminar-good-game-league-2018"

LAST_LINK_TO_DOWNLOAD = "https://www.hltv.org/matches/2300123/summit-vs-lazy-dngit-ncsc-korea-qualifier-season2"

def getRawData(url, useragent = 'Mozilla/5.0 (Linux; Android 4.4.2; en-us; SAMSUNG SM-G386T Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Version/1.6 Chrome/28.0.1500.94 Mobile Safari/537.36'):

	# User Agent Mozilla to Circumvent Security Blocking
	req = Request(url, headers={'User-Agent': useragent})

	# Connect and Save the HTML Page
	uClient = urlopen(req)
	page_html = uClient.read()
	uClient.close()

	# Parse HTML
	page_soup = soup(page_html, "html.parser")
	return page_soup

def getWebsitePredictions(days = 1, writeToFile = False):
	url = "https://www.hltv.org/matches"
	matchlinks = []
	res = []
	fullname = None
	#update_data()
	#EloHandler.calcEloOnDataset()
	page_soup = getRawData(url)
	matchday_table = page_soup.findAll("div", {"class":"match-day"})
	index = 0
	for matchday in matchday_table:
		if index>= days:
			break
		matches = matchday.findAll("a", {"href":True})
		for match in matches:
			index = str(match).find('href="')
			index2 = str(match)[index+6:].find('"')
			matchurl = str(match)[index+6:index + 6 + index2]
			#print(matchurl)
			Team1,Team2,team1Name,team2Name = getPlayerIDsFromMatchLink("https://www.hltv.org" + matchurl)
			if Team1 == -1: 
				res.append("Player not Known ERROR")
				continue
			team1pred, team2pred = EloHandler.predictGame(Team1,Team2)
			res.append(team1Name + " vs. " + team2Name + " Winrate prediction -> " + str(team1pred) + "-" + str(team2pred))
		index += 1
	return res



def getRecentPredictions(num=50):
	res = []
	index = 0
	with open("predictions.csv", encoding="utf-8") as predictions:
		for line in predictions:
			split = line.split(";")
			res += (split[0] + split[1] + "| Prediction -> " + split[2] + "-" +  split[3])
			if index>num: break
			index +=1
	return res

def findMatchLinks(page_soup):
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

def getGeneralMatchInfo(url):
	mapsPlayed = []
	scores = []
	page_soup = getRawData(url)
	splitted = url.split("/")
	gameID = splitted[4]
	teams = []
	time = page_soup.find("div",{"class":"time"}).text
	date = page_soup.find("div",{"class":"date"}).text
	year = date[-4:]
	day = int((date.split(" ")[0])[0:-2])
	month = date.split(" ")[2]
	maps = page_soup.findAll("div", {"class": "mapholder"})
	for map in maps:
		if map.find("div",{"class": "played"}) is None: continue
		if map.find("div",{"class":"mapname"}).text == "Default": continue
		mapsPlayed.append(map.find("div", {"class": "mapname"}).text)
		score = ""
		if map.find("span",{"class": "won"}) is None:
			score = "15:15"
			continue
		score = score + (map.find("span",{"class": "won"}).text)
		score += ":"
		score = score + (map.find("span",{"class": "lost"}).text)
		scores.append(score)
	team1 = page_soup.find("div", {"class": "team1-gradient"})
	team2 = page_soup.find("div", {"class": "team2-gradient"})
	team1Name = team1.find("div", {"class": "teamName"}).text
	team2Name = team2.find("div", {"class": "teamName"}).text
	#mapveto = []
	#veto = page_soup.find("div", {"class":"standard-box veto-box"})
	#vetoitem = veto.find("div")
	teamhrefs = page_soup.find_all("tr", {"class":"header-row"})
	teamIDs = []
	team1ID = None
	team2ID = None
	i = 0
	for teamhref in teamhrefs:
		i +=1
		link = teamhref.find("a", {"href":True})
		if link is not None:
			linklist = str(link).split("/")
			if linklist[2] in teamIDs: continue
			teamIDs.append(linklist[2])
			if i is 1: team1ID = linklist[2]
			else: team2ID = linklist[2]
	team1score = team1.find("div", {"class": "lost"})
	temp = team1score
	if team1score is None:
		temp = team1.find("div", {"class": "won"})
		temp2 = team2.find("div", {"class": "lost"})
		if temp is None: 
			temp = team1.find("div", {"class": "tie"})
			temp2 = team2.find("div", {"class": "tie"})	
	else:
		temp2 = team2.find("div", {"class": "won"})
	team1score = temp.text
	team2score = temp2.text	
	# print("gameID = " + gameID)	
	# print("team1 Name = " + team1Name)
	# print("team1 Score = " + team1score)
	# print("team2 Name = " + team2Name)
	# print("team2 Score = " + team2score)
	# print(time + " | " + date)
	# print("Format = " + vetoitem.text[0:9])
	# print(day)
	# print(month)
	# print(year)
	index = 0
	for map in mapsPlayed:
		#print(map)
		#print(scores[index])
		index+=1		
	return gameID, team1Name, team2Name,team1ID, team2ID, team1score, team2score, day ,month, year

def getKillMatrices(url):
	req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})

	uClient = urlopen(req)
	page_html = uClient.read()
	uClient.close()

	tables = pd.read_html(page_html)

	print("#### KILL MATRIX ####")
	print("All Kills")
	print(tables[1].to_csv())
	print("--------------------")
	print("#### KILL MATRIX ####")
	print("First Kills")
	print(tables[2])
	print("--------------------")
	print("#### KILL MATRIX ####")
	print("Awp Kills")
	print(tables[3])
	print("--------------------")

def getPlayerStats(url):
	players = []
	fullname = None
	page_soup = getRawData(url)
	stats_table = page_soup.find("div", {"class":"stats-content"})
	playerlist = stats_table.findAll("tr")
	for player in playerlist:
		playerID = player.find("a", {"href":True})
		if playerID is not None:
			playerID = str(playerID).split("/")[2]
		kd_ratio = player.find("td", {"class":"kd text-center"})
		adr = player.find("td", {"class":"adr text-center "}) #Average Damage per Round
		kast = player.find("td", {"class":"kast text-center"})
		rating = player.find("td", {"class":"rating text-center"})
		playerhref = player.find("a", {"href":True})
		hreflist = playerhref.text.split("\n")
		if len(hreflist) > 3:
			fullname = hreflist[2]
			playername = hreflist[3]
		if fullname is not None and kd_ratio.text is not "K-D" and adr is not None:
			# print(fullname)
			# print(kd_ratio.text)
			# print(adr.text)
			# print(kast.text)
			# print(rating.text)
			print("[ ID:" + playerID + " | Name: " + fullname + " |KD: " + kd_ratio.text + " |" +"ADR: " + adr.text + " |" + "Rating: " + rating.text + "]")	

def getEloSystemData(url):
	players = []
	fullname = None
	page_soup = getRawData(url)
	stats_table = page_soup.find("div", {"class":"stats-content"})
	if stats_table is None:
		lineup_table = page_soup.find("div", {"class":"lineups"})
		player_portraits = lineup_table.findAll("td", {"class":"player"})
		for player in player_portraits:
			playerhref = player.find("a", {"href":True})
			if playerhref is None: continue
			hreflist = str(playerhref).split("\n")
			playerattributes = hreflist[0].split("/")
			playerID = playerattributes[2]
			playerName = str(playerattributes[3])[:-2]
			players.append(str(playerName) + ";" + str(playerID))
	else:
		playerlist = stats_table.findAll("tr")
		for player in playerlist:
			playerID = player.find("a", {"href":True})
			if playerID is not None:
				playerID = str(playerID).split("/")[2]
			playerhref = player.find("a", {"href":True})
			hreflist = playerhref.text.split("\n")
			if len(hreflist) > 3:
				playername = hreflist[3]
				players.append(str(playername) + ";" + str(playerID))
	if len(players) is not 10: return None
	team1 = players[0:5]
	team2 = players[5:10]
	#return gameID, team1name, team2name, team1score, team2score, day ,month, year
	gameID, team1name, team2name, team1ID, team2ID,team1score, team2score, day ,month, year = getGeneralMatchInfo(url)
	#print(gameID, team1name, team2name, team1score, team2score, day ,month, year)
	with open("data.csv","a",encoding='utf-8') as csvfile:
		for player in team1:
			line = str(player) + ";" + "1" + ";" + str(gameID) + ";" + str(team1name) + ";" +str(team2name) + ";" + str(team1ID) + ";" + str(team2ID) + ";" + str(team1score)+";"+str(team2score) + ";" + str(year)+"-"+str(month)+"-"+str(day)+"\n" 
			csvfile.write(line)
			#writeLineToFile(line)
		for player in team2:
			line = str(player) + ";" + "2" + ";" + str(gameID) + ";" + str(team1name) + ";" +str(team2name) + ";" + str(team1ID) + ";" + str(team2ID) + ";" + str(team1score)+";"+str(team2score) + ";" + str(year)+"-"+str(month)+"-"+str(day)+"\n" 
			csvfile.write(line)
			#writeLineToFile(line)
	#s = "GameID = " + str(gameID) + " ; Team1 = " + str(team1name) + " ; Team2 = " +str(team2name)+ " ; Players1 = " + str(team1) + " ; Players2 = " + str(team2) + " ; Score = " + team1score+"|"+team2score 		

def getUpdateData(url):
	players = []
	fullname = None
	page_soup = getRawData(url)
	stats_table = page_soup.find("div", {"class":"stats-content"})
	if stats_table is None:
		lineup_table = page_soup.find("div", {"class":"lineups"})
		player_portraits = lineup_table.findAll("td", {"class":"player"})
		for player in player_portraits:
			playerhref = player.find("a", {"href":True})
			if playerhref is None: continue
			hreflist = str(playerhref).split("\n")
			playerattributes = hreflist[0].split("/")
			playerID = playerattributes[2]
			playerName = str(playerattributes[3])[:-2]
			players.append(str(playerName) + ";" + str(playerID))
	else:
		playerlist = stats_table.findAll("tr")
		for player in playerlist:
			playerID = player.find("a", {"href":True})
			if playerID is not None:
				playerID = str(playerID).split("/")[2]
			playerhref = player.find("a", {"href":True})
			hreflist = playerhref.text.split("\n")
			if len(hreflist) > 3:
				playername = hreflist[3]
				players.append(str(playername) + ";" + str(playerID))
	if len(players) is not 10: return None
	team1 = players[0:5]
	team2 = players[5:10]
	#return gameID, team1name, team2name, team1score, team2score, day ,month, year
	gameID, team1name, team2name, team1ID, team2ID,team1score, team2score, day ,month, year = getGeneralMatchInfo(url)
	#print(gameID, team1name, team2name, team1score, team2score, day ,month, year)
	data = []
	with open("data.csv","a",encoding='utf-8') as csvfile:
		for player in team1:
			line = str(player) + ";" + "1" + ";" + str(gameID) + ";" + str(team1name) + ";" +str(team2name) + ";" + str(team1ID) + ";" + str(team2ID) + ";" + str(team1score)+";"+str(team2score) + ";" + str(year)+"-"+str(month)+"-"+str(day)+"\n" 
			data.append(line)
			#writeLineToFile(line)
		for player in team2:
			line = str(player) + ";" + "2" + ";" + str(gameID) + ";" + str(team1name) + ";" +str(team2name) + ";" + str(team1ID) + ";" + str(team2ID) + ";" + str(team1score)+";"+str(team2score) + ";" + str(year)+"-"+str(month)+"-"+str(day)+"\n" 
			data.append(line)
	return data			

def line_prepender(filename, line):
    with open(filename, 'r+', encoding="utf-8") as f:
        content = f.read()
        f.seek(0, 0)
        f.write(line.rstrip('\r\n') + '\n' + content)

def update_data():
	with open("data.csv","r") as file:
		line = file.readline()
		if (len(line.split(";")) > 3):
			gameID = line.split(";")[3]
		else: gameID = 2330963
	hltvlink = "https://www.hltv.org/results"
	index = 1
	data = []
	while True:
		UserAgentList = ["Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.5; en-US; rv:1.9.1b3) Gecko/20090305 Firefox/3.1b3 GTB5","Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.5; ko; rv:1.9.1b2) Gecko/20081201 Firefox/3.1b2","Mozilla/5.0 (X11; U; SunOS sun4u; en-US; rv:1.9b5) Gecko/2008032620 Firefox/3.0b5","Mozilla/5.0 (X11; U; Linux x86_64; en-US; rv:1.8.1.12) Gecko/20080214 Firefox/2.0.0.12","Mozilla/5.0 (Windows; U; Windows NT 5.1; cs; rv:1.9.0.8) Gecko/2009032609 Firefox/3.0.8","Mozilla/5.0 (X11; U; OpenBSD i386; en-US; rv:1.8.0.5) Gecko/20060819 Firefox/1.5.0.5","Mozilla/5.0 (Windows; U; Windows NT 5.0; es-ES; rv:1.8.0.3) Gecko/20060426 Firefox/1.5.0.3","Mozilla/5.0 (Windows; U; WinNT4.0; en-US; rv:1.7.9) Gecko/20050711 Firefox/1.0.5","Mozilla/5.0 (Windows; Windows NT 6.1; rv:2.0b2) Gecko/20100720 Firefox/4.0b2","Mozilla/5.0 (X11; Linux x86_64; rv:2.0b4) Gecko/20100818 Firefox/4.0b4","Mozilla/5.0 (X11; U; Linux i686; en-US; rv:1.9.2) Gecko/20100308 Ubuntu/10.04 (lucid) Firefox/3.6 GTB7.1","Mozilla/5.0 (Windows NT 6.1; WOW64; rv:2.0b7) Gecko/20101111 Firefox/4.0b7","Mozilla/5.0 (Windows NT 6.1; WOW64; rv:2.0b8pre) Gecko/20101114 Firefox/4.0b8pre","Mozilla/5.0 (X11; Linux x86_64; rv:2.0b9pre) Gecko/20110111 Firefox/4.0b9pre","Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:2.0b9pre) Gecko/20101228 Firefox/4.0b9pre","Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:2.2a1pre) Gecko/20110324 Firefox/4.2a1pre","Mozilla/5.0 (X11; U; Linux amd64; rv:5.0) Gecko/20100101 Firefox/5.0 (Debian)","Mozilla/5.0 (Windows NT 6.1; WOW64; rv:6.0a2) Gecko/20110613 Firefox/6.0a2","Mozilla/5.0 (X11; Linux i686 on x86_64; rv:12.0) Gecko/20100101 Firefox/12.0","Mozilla/5.0 (Windows NT 6.1; rv:15.0) Gecko/20120716 Firefox/15.0a2","Mozilla/5.0 (X11; Ubuntu; Linux armv7l; rv:17.0) Gecko/20100101 Firefox/17.0","Mozilla/5.0 (Windows NT 6.1; rv:21.0) Gecko/20130328 Firefox/21.0","Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:22.0) Gecko/20130328 Firefox/22.0","Mozilla/5.0 (Windows NT 5.1; rv:25.0) Gecko/20100101 Firefox/25.0","Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:25.0) Gecko/20100101 Firefox/25.0","Mozilla/5.0 (Windows NT 6.1; rv:28.0) Gecko/20100101 Firefox/28.0","Mozilla/5.0 (X11; Linux i686; rv:30.0) Gecko/20100101 Firefox/30.0","Mozilla/5.0 (Windows NT 5.1; rv:31.0) Gecko/20100101 Firefox/31.0","Mozilla/5.0 (Windows NT 6.1; WOW64; rv:33.0) Gecko/20100101 Firefox/33.0","Mozilla/5.0 (Windows NT 10.0; WOW64; rv:40.0) Gecko/20100101 Firefox/40.0"]
		page_soup = getRawData(hltvlink, useragent = random.choice(UserAgentList))
		matchlinks = findMatchLinks(page_soup)
		nextpageurl = findLinkToNextPage(page_soup)
		for link in matchlinks:
			splittedlink = str(link).split("/")
			if splittedlink[4] == str(gameID):
				for line in reversed(data):
					line_prepender("data.csv",line)
				return
			print("Downloading No:" +  str(index) + " | Link: " + str(link))
			index +=1
			newData = getUpdateData(link)
			if newData is not None: data = data + newData
			if link == "https://www.hltv.org/matches/2330014/valiance-vs-red-reserve-united-masters-league":
				print("Downloading Finished | Database is now complete")
		hltvlink = nextpageurl		

def downloadStuff():
	index = 1
	hltvlink = HLTV_MATCHES_LINK
	while True:
		page_soup = getRawData(hltvlink)
		matchlinks = findMatchLinks(page_soup)
		nextpageurl = findLinkToNextPage(page_soup)
		for link in matchlinks:
			print("Downloading No:" +  str(index) + " | Link: " + str(link))
			index +=1
			getEloSystemData(link)
			if link == "https://www.hltv.org/matches/2300123/summit-vs-lazy-dngit-ncsc-korea-qualifier-season2":
				print("Downloading Finished | Database is now complete")
		hltvlink = nextpageurl	

def downloadFromLinkOnwards(results_url):
	index = 1
	hltvlink = results_url
	while True:
		page_soup = getRawData(hltvlink)
		matchlinks = findMatchLinks(page_soup)
		nextpageurl = findLinkToNextPage(page_soup)
		for link in matchlinks:
			print("Downloading No:" +  str(index) + " | Link: " + str(link))
			index +=1
			getEloSystemData(link)
			if link == "https://www.hltv.org/matches/2300123/summit-vs-lazy-dngit-ncsc-korea-qualifier-season2":
				print("Downloading Finished | Database is now complete")
		hltvlink = nextpageurl	

def getPlayerIDsFromMatchLink(url):
	Team1 = []
	Team2 = []
	Teams = []
	counter = 0
	page_soup = getRawData(url)

	team1 = page_soup.find("div", {"class": "team1-gradient"})
	team2 = page_soup.find("div", {"class": "team2-gradient"})
	if ((team1 is None) or (team2 is None)):
		print("Teams not yet decided")
		return -1,-1,-1,-1
	team1Name = team1.find("div", {"class": "teamName"}).text
	team2Name = team2.find("div", {"class": "teamName"}).text

	players = page_soup.findAll("td", {"class":"player"})
	for player in players:
		index = str(player).find('/player/')
		string = str(player)[index:index+50]
		index2 = string.find(">")
		string2 = string[:index2]
		#print(string2)
		if "player" in string2:
			ID = string2.split("/")[2]
			Teams.append(ID)
	#print(players[2])		
	if len(Teams)<15:return -1,-1,-1,-1
	Team2.append(Teams[10])
	Team2.append(Teams[11])
	Team2.append(Teams[12])
	Team2.append(Teams[13])
	Team2.append(Teams[14])
	Team1.append(Teams[0])
	Team1.append(Teams[1])
	Team1.append(Teams[2])
	Team1.append(Teams[3])
	Team1.append(Teams[4])			
	return Team1,Team2,team1Name,team2Name				

def predictGame(url, writeToFile = False):
	Team1,Team2,team1Name,team2Name = getPlayerIDsFromMatchLink(url)
	if Team1 == -1: 
		print("Player not Known ERROR")
		return
	print()
	print("--------------------")
	print(team1Name + " vs. " + team2Name)
	team1pred, team2pred = EloHandler.predictGame(Team1,Team2)
	print("--------------------")
	if writeToFile:
		with open("predictions.csv","a") as file:
			file.write("\n" + str(team1Name) + ";" + str(team2Name) + ";" + team1pred + ";" + team2pred + ";" + str(Team1) + ";" + str(Team2))
	return [team1pred,team2pred]		

def getPredictions(days = 1, writeToFile = False):
	url = "https://www.hltv.org/matches"
	matchlinks = []
	fullname = None
	update_data()
	EloHandler.calcEloOnDataset()
	page_soup = getRawData(url)
	matchday_table = page_soup.findAll("div", {"class":"match-day"})
	index = 0
	for matchday in matchday_table:
		if index>= days:
			break
		matches = matchday.findAll("a", {"href":True})
		for match in matches:
			index = str(match).find('href="')
			index2 = str(match)[index+6:].find('"')
			matchurl = str(match)[index+6:index + 6 + index2]
			gameID = matchurl.split("/")[2]
			Team1,Team2,team1Name,team2Name = getPlayerIDsFromMatchLink("https://www.hltv.org" + matchurl)
			if Team1 == -1:
				print("Player not Known ERROR")
				continue
			print()
			print("--------------------")
			print(team1Name + " vs. " + team2Name)
			team1pred, team2pred = EloHandler.predictGame(Team1,Team2)
			print("--------------------")
			if writeToFile:
				with open("predictions.csv","a") as file:
					file.write("\n" + str(team1Name) + ";" + str(team2Name) + ";" + str(gameID) + ";" + team1pred + ";" + team2pred + ";" + str(Team1) + ";" + str(Team2))
		index += 1
	return -1	

def predictionRate():
	rating = [0,0]
	#open Predictions and Data.csv to compare
	with open("C:\\Users\\Jakob\\Projects\\csgogamble\\predictions.csv") as predictions:
		for game in predictions:
			with open("C:\\Users\\Jakob\\Projects\\csgogamble\\data.csv", encoding="utf-8") as data:
				winner = 0
				team1 = game.split(";")[0]
				team2 = game.split(";")[1]
				prediction1 = game.split(";")[2]
				prediction2 = game.split(";")[3]
				if int(prediction1) >= int(prediction2):
					PredictedWinner = 1
				else:
					PredictedWinner = 2
				for line in data:
					dteam1 = line.split(";")[4]
					dteam2 = line.split(";")[5]
					score1 = line.split(";")[8]
					score2 = line.split(";")[9]
					if team1==dteam1 and team2==dteam2:
						if score1>score2 and PredictedWinner==1:
							rating[0] += 1
							break
						if score1<score2 and PredictedWinner==1:
							rating[1] += 1
							break
						if score1>score2 and PredictedWinner==2:
							rating[1] += 1
							break
						if score1<score2 and PredictedWinner==2:
							rating[0] += 1
							break
	return "Average Accuracy: " + str(rating[0]/(rating[0]+rating[1])*100) + " | " + "# of accurate Predictions/Total: " + str(rating)								



def doStuff():
	

	
	Team1,Team2,team1Name,team2Name = getPlayerIDsFromMatchLink("https://www.hltv.org" + matchlink)
	print()
	print("--------------------")
	print(team1Name + " vs. " + team2Name)
	EloHandler.predictGame(Team1,Team2)
	print("--------------------")
	

#EloHandler.calcEloOnDataset()

#print(getPlayerIDsFromMatchLink("https://www.hltv.org/matches/2332415/forze-vs-ancient-lootbet-hotshot-series-season-2"))

#print(predictionRate())

#getPredictions(writeToFile=True)
# linklist = [
# "https://www.hltv.org/matches/2331052/nrg-vs-avangar-iem-katowice-2019",
# "https://www.hltv.org/matches/2331053/mibr-vs-complexity-iem-katowice-2019",
# "https://www.hltv.org/matches/2331054/natus-vincere-vs-vitality-iem-katowice-2019",
# "https://www.hltv.org/matches/2331055/faze-vs-renegades-iem-katowice-2019",
# "https://www.hltv.org/matches/2331056/liquid-vs-nip-iem-katowice-2019",
# "https://www.hltv.org/matches/2331057/astralis-vs-cloud9-iem-katowice-2019"]
# for link in linklist: predictGame(link, writeToFile = True)

last_error_game = "https://www.hltv.org/matches/2318149/kon-denmark-vs-kon-finland-king-of-nordic-season-9"
