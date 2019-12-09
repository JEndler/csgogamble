#OddsScraper
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
import csv
import pandas
import time
from datetime import datetime
import json

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


def findMatchLinks(page_soup, date = None):
	match_link_list = []
	matchday = page_soup.find("div", {"class": "upcoming-matches"})
	matchday = matchday.find("div", {"class": "match-day"})
	for link in matchday.findAll("a", {"href":True}):
		if "matches" in str(link["href"]):
			match_link_list.append("https://www.hltv.org" + str(link['href']))
	return match_link_list

def analyseUpcomingMatch(url):
	_BETTING_PROVIDERS = ["ggbet-odds geoprovider_ggbet betting_provider",
												" geoprovider_betway betting_provider",
												" geoprovider_lootbet betting_provider",
												" geoprovider_egb betting_provider",
												"thunderpick-odds geoprovider_thunderpick betting_provider",
												" geoprovider_bet365 betting_provider"]
	_BETTING_PROVIDER_NAMES = ["gg.bet", "betway","loot.bet","egb","thunderpick","bet365"]
	page_soup = getRawData(url)
	time = page_soup.find("div", {"class": "time"})
	currentTime = str(datetime.now())
	#'2011-05-03 17:45:35.177000'
	currentHour = currentTime.split(" ")[1]
	currentHour = int(currentHour.split(":")[0])
	currentMin = int(currentTime.split(":")[-2])
	#Convert to Total Min for easy comparison
	currentMin += currentHour*60
	gameHour = int(time.text.split(":")[0])
	gameMin = int(time.text.split(":")[1]) + int(gameHour*60)
	timeTillGame = gameMin - currentMin
	gameID = str(url.split("/")[4])
	#print("Game with ID: " + gameID + " | min until start: " + str(timeTillGame))
	res = {}
	res["gameID"] = gameID
	res["scrapedAt"] = str(datetime.now())
	if timeTillGame < 10:
		for provider in _BETTING_PROVIDERS:
			row = page_soup.find("tr",{"class":provider})
			odds = (row.text.strip().replace("\n","").split("-"))
			providerName = _BETTING_PROVIDER_NAMES[_BETTING_PROVIDERS.index(provider)] 
			try:
				assert len(odds) == 2
				res[str(_BETTING_PROVIDER_NAMES[_BETTING_PROVIDERS.index(provider)])] = (odds[0],odds[1])
			except AssertionError as e:
				print("No Odds Data for Provider: " + providerName + " with GameID: " + str(gameID))
		print("Wrote odds to File | GameID: " + str(gameID) + " | scraped at: " + str(datetime.now()))
		writeOddsToFile(res)

def writeOddsToFile(resdict):
	with open("data/odds.txt","a",encoding='utf-8') as oddsfile:
		oddsfile.write(json.dumps(resdict))

def main():
	_HLTV_MATCHES = "https://www.hltv.org/matches"
	for link in findMatchLinks(getRawData(_HLTV_MATCHES)):
		analyseUpcomingMatch(link)

if __name__ == "__main__":
	main()
