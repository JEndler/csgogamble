#OddsScraper
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
import csv
import pandas
import time
from datetime import datetime

def getRawData(url):

	# User Agent Mozilla to Circumvent Security Blocking
	req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:47.0) Gecko/20100101 Firefox/47.0'})

	# Connect and Save the HTML Page
	uClient = urlopen(req)
	page_html = uClient.read()
	uClient.close()

	# Parse HTML
	page_soup = soup(page_html, "html.parser")
	return page_soup

#class="a-reset block upcoming-match standard-box"

def findMatchLinks(page_soup, date = None):
	match_link_list = []
	matchday = page_soup.find("div", {"class": "upcoming-matches"})
	matchday = matchday.find("div", {"class": "match-day"})
	for link in matchday.findAll("a", {"href":True}):
		match_link_list.append("https://www.hltv.org" + str(link['href']))
	return match_link_list


def analyseUpcomingMatch(url):
	page_soup = getRawData(url)
	dataframes = pandas.read_html(str(page_soup))

	time = page_soup.find("div", {"class": "time"})
	print(time.text)

	currentTime = str(datetime.now())
	#'2011-05-03 17:45:35.177000'
	currentHour = currentTime.split(" ")[1]
	currentHour = int(currentHour.split(":")[0])

	currentMin = int(currentTime.split(":")[-2])
	#Convert to Total Min for easy comparison
	currentMin += currentHour*60

	gameHour = int(time.text.split(":")[0])
	gameMin = int(time.text.split(":")[1]) + int(gameHour*60)

	print(gameMin)
	print(currentMin)

	timeTillGame = gameMin - currentMin
	odds_df = dataframes[0]

	team1 = page_soup.find("div", {"class": "team1-gradient"})
	team2 = page_soup.find("div", {"class": "team2-gradient"})

	splitted = url.split("/")
	gameID = splitted[4]

	# countdown = page_soup.find("div", {"class": "countdown"})
	# print(countdown.text.split(":")[1])
	# print(len(countdown.text.split(":")))
	# print(int(countdown.text.split(":")[0][0:-2]))
	# if len(countdown.text.split(":")) > 2:
	# 	return -1,-1
	# if int(countdown.text.split(":")[0][0:-2]) > 15:
	# 	return -1,-1

	#If the countdown is less than 15min -> Download and save Odds
	#Check every 5 min

	#Websites in List: ["EGB.com","betway","loot.bet","gg.bet","Thunderpick","csgopositive","bet365","1xbet","pinnacle","buff.bet","unibet","22bet","bets.net","betit","unikrn"]
	#The second lists are [team1win, draw, team2win]
	Oddslist = [[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1]]
	for team in range(3):
		Oddslist[0][team] = str(odds_df[team+1][1])
		Oddslist[1][team] = str(odds_df[team+1][3])
		# Oddslist[2][team] = str(odds_df[team+1][4])
		# Oddslist[3][team] = str(odds_df[team+1][5])
		# Oddslist[4][team] = str(odds_df[team+1][8])
		# Oddslist[5][team] = str(odds_df[team+1][9])
		# Oddslist[6][team] = str(odds_df[team+1][10])
		# Oddslist[7][team] = str(odds_df[team+1][11])
		# Oddslist[8][team] = str(odds_df[team+1][15])
		# Oddslist[9][team] = str(odds_df[team+1][18])
		# Oddslist[10][team] = str(odds_df[team+1][19])
		# Oddslist[11][team] = str(odds_df[team+1][27])
		# Oddslist[12][team] = str(odds_df[team+1][30])
		# Oddslist[13][team] = str(odds_df[team+1][32])
		# Oddslist[14][team] = str(odds_df[team+1][34])

	for item in Oddslist:
		for i in range(3):
			if len(str(item[i])) > 4 or str(item[i]) == "nan":
				item[i] = -1

	if timeTillGame < 60:
		writeOddsToFile(gameID, Oddslist)

	return gameID, Oddslist
	
def writeOddsToFile(gameID, Oddslist):
	with open("odds.csv","a",encoding='utf-8') as oddsfile:
		s = str(gameID)
		for item in Oddslist:
			s += ";["+ str(item[0]) + "," + str(item[1]) + "," + str(item[2]) +"]"
		oddsfile.write(s)

url = "https://www.hltv.org/matches/2332503/avant-vs-control-iem-sydney-2019-oceania-closed-qualifier"

# while True:
# 	for matchlink in findMatchLinks(getRawData(url)):
# 		gameID, Oddslist = analyseUpcomingMatch(matchlink)
# 		if gameID is not -1 and Oddslist is not -1:
# 			print("Writing Odds to file for Game: " + str(gameID))
# 			writeOddsToFile(gameID, Oddslist)
# 	time.sleep(300)


gameID, Oddslist = analyseUpcomingMatch(url)
print(Oddslist[1])
# writeOddsToFile(gameID, Oddslist)
