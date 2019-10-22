from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
import pandas as pd
import random
from datetime import date
#from typing import TypedDict

#@Author: Jakob Endler
#This Class is responsible for handling the interaction with HLTV
#it scrapes the relevant Data and hands it over to the Database Manager
#Relevant Data can be found in the "DatabaseLayout.PNG" File

uagent = 'Mozilla/5.0 (Linux; Android 4.4.2; en-us; SAMSUNG SM-G386T Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Version/1.6 Chrome/28.0.1500.94 Mobile Safari/537.36'

# class Match(TypedDict):
#   MatchID: int
#   Date: date
#   Format: str
#   Team1: str
#   Team2: str
#   Score: tuple #Ideally (16,8) - Score of Team1, Score of Team2
#   MapID: int
#   Team1ID: int
#   Team2ID: int
#   Link: str
#   scrapedTimestamp: datetime

# currentMatch: Match = {}

def getRawData(url, useragent = uagent):

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


if __name__ == "__main__":
	testmatch = "https://www.hltv.org/matches/2336722/natus-vincere-vs-hellraisers-esl-pro-league-season-10-europe"
	print(getGeneralMatchInfo(testmatch))