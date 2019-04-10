import bs4
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup
import sqlite3
import pandas as pd
import pickle


def GetCurLink(OffSet):
	return  "https://www.hltv.org/results?offset=" + str(OffSet) +"&startDate=2017-02-01&endDate=2018-04-30"

def GetRawData(url):
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    uClient = urlopen(req)
    page_html = uClient.read()
    uClient.close()
    page_soup = soup(page_html, "html.parser")
    return page_soup

def GetMatchPages(RawData):

	MatchLinks = []

	SubGame = RawData.findAll('div', class_ = "results-sublist")
	for SubGames in SubGame:
		SingleGames = SubGames.findAll("div", class_ = "result-con")
		for Game in SingleGames:
			for url in Game.findAll("a"):
				MatchLinks.append("https://www.hltv.org"+str(url.get("href")))
	return MatchLinks

def GetDetailPages(MatchData):
	
	Data = []
	detailLink = MatchData.find('div',class_ = "small-padding stats-detailed-stats")
	if detailLink == None:
		return None
	if detailLink.find('a') == None:
		return None
	link = detailLink.find('a').get("href")

	Data.append("https://www.hltv.org"+link)
	Data.append("https://www.hltv.org"+link[:14]+"/performance"+link[14:])
	Data.append("https://www.hltv.org"+link[:14]+"/heatmap"+link[14:]+"?showKills=true&showDeaths=false&firstKillsOnly=false&allowEmpty=false&showKillDataset=true&showDeathDataset=true")

	Maps = GetRawData("https://www.hltv.org"+link).find('div',class_ = 'stats-match-maps')
	Map = Maps.findAll('a',class_ = "col stats-match-map standard-box a-reset inactive")


	#print("____________________")
	#for m in Map:
	#	print(m.get("href"))
	if len(Map) == 0:
		return Data
	else:
		Data = []
		for m in Map:
			link = m.get("href")
			Data.append("https://www.hltv.org" + link)
			Data.append("https://www.hltv.org"+link[:14]+"/performance"+link[14:])
			Data.append("https://www.hltv.org"+link[:14]+"/heatmap"+link[14:])
		return Data


def GetOverview(Page):
	soup = GetRawData(Page)
	
	Data = []

	InfoBox = soup.find('div',class_ = "match-info-box")
	Small = InfoBox.find('div', class_ = "small-text")
	Date = Small.text[:-3]
	Data.append(Date)

	Lines = InfoBox.text.splitlines()
	Map = Lines[2]

	TeamLeft = InfoBox.find('div', class_ = "team-left")
	TeamRight = InfoBox.find('div', class_ = "team-right")

	leftteam = TeamLeft.text.splitlines()[0]
	rightteam = TeamRight.text.splitlines()[0]

	leftscore = TeamLeft.text.splitlines()[1]
	rightscore = TeamRight.text.splitlines()[1]

	Data.append(leftteam)
	Data.append(leftscore)
	Data.append(rightteam)
	Data.append(rightscore)
	Data.append(Map)

	Tables = soup.findAll('table',class_ = "stats-table")
	for table in Tables:
		Team = table.find('th',class_ = "st-teamname text-ellipsis").text
		df = pd.read_html(str(table))[0]

		pickledf = pickle.dumps(df,protocol=pickle.HIGHEST_PROTOCOL)
		Data.append(pickledf)
	return Data
	#returns[Date, Leftteam,leftscore,rightteam,rightscore,map,Performance team 1, Performance team 2]

def GetPerformance(Page):
	soup = GetRawData(Page)
	Tables = soup.findAll('table',class_="stats-table")
	Matrices = []
	for Table in Tables:
		df = pd.read_html(str(Table))[0]

		pickledf = pickle.dumps(df, protocol=pickle.HIGHEST_PROTOCOL)
		Matrices.append(pickledf)

	return Matrices
	#returns [All, First Kills, AWP kills]
def GetHeatmaps(Page):
	Page = Page+("&allowEmpty=true")
	soup = GetRawData(Page)
	#todo
	return

	


def GetData(DetailPages):
	for index in range(int(len(DetailPages)/3)):
		Overview = GetOverview(DetailPages[index*3])
		Performance = GetPerformance(DetailPages[index*3+1])
		#Heatmaps = GetHeatmaps(DetailPages[index*3+2])
	conn = sqlite3.connect('ScrapedData.db',timeout=10)
	c = conn.cursor()
	c.execute("CREATE TABLE IF NOT EXISTS Matches(id INTEGER, Team1 TEXT, Score1 INTEGER, Team2 TEXT, Score2 INTEGER, Map TEXT, GameTime TEXT, Performance1 TEXT, Performance2 TEXT,AllMatrix TEXT,FirstMatrix TEXT,AWPMatrix TEXT)")

	c.execute("SELECT MAX(id) FROM Matches")
	ID = c.fetchall()
	if ID == [(None,)]:
		ID = 0
	else:
		print(ID)
		ID = ID[0][0]+1
	c.execute("SELECT * FROM Matches WHERE Team1 = ? AND Team2 = ? AND GameTime = ? AND Map = ?",(Overview[1],Overview[3],Overview[0],Overview[5]))
	if c.fetchall() == []:
		c.execute("INSERT INTO Matches (id, Team1, Score1, Team2, Score2, Map, GameTime, Performance1, Performance2,AllMatrix,FirstMatrix,AWPMatrix) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",(ID,Overview[1],Overview[2],Overview[3],Overview[4],Overview[5],Overview[0],Overview[6],Overview[7],Performance[0],Performance[1],Performance[2]))
		conn.commit()
	c.close()

#print(GetOverview("https://www.hltv.org/stats/matches/mapstatsid/65708/kinguin-vs-red-reserve"))

C = 0

Pagesback = 130

for k in range(Pagesback):
	kk = Pagesback-k-1
	MatchPages = GetMatchPages(GetRawData(GetCurLink(kk*100)))
	for i in range(len(MatchPages)):
		ii = len(MatchPages)-i-1
		
		try:
			GetData(GetDetailPages(GetRawData(MatchPages[ii])))
		except:
			pass
