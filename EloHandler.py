import numpy
import math
import sqlite3
from urllib.request import urlopen
from urllib.request import Request
from bs4 import BeautifulSoup as soup

def getRounds(gameID):
	winnerlist = []
	with open("C:\\Users\\Jakob\\Projects\\csgogamble\\data.csv","r",encoding="utf-8") as HLTVData:
		data = HLTVData.readlines()
	for line in data:
		if str(gameID) == line.split(";")[3]:
			scoreTeam1 = line.split(";")[8]
			scoreTeam2 = line.split(";")[9]
			if (int(scoreTeam2) + int(scoreTeam1) < 15):
				for i in range(int(scoreTeam1)):
					winnerlist.append(0)
				for i in range(int(scoreTeam2)):
					winnerlist.append(1)
			else:
				score = 0 if scoreTeam1>scoreTeam2 else 1
				winnerlist.append(score)#					
			return winnerlist #Winner is either 0 or 1 depending on which team won
	return -1		

def getEloForPlayer(playerID):
	if ("PlayerID="+str(playerID)) not in open('C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt').read():
		with open("C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt","a",encoding="utf-8") as EloFile:
			EloFile.write("\nPlayerID="+ str(playerID) + ";Elo=1000")
		return 1000	
	with open("C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt","r",encoding="utf-8") as EloFile:
		data = EloFile.readlines()
	for line in data:
		if ("PlayerID="+str(playerID)) in line:
			elo = line.split("=")[-1]
			if "\n" in elo: 
				elo = elo[:-1]
			return float(elo)
	return -1		

def updateEloRating(playerID, Elo):
	if ("PlayerID="+str(playerID)) not in open('C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt').read():
		#print("Didnt find player in File")
		with open("C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt","a",encoding="utf-8") as EloFile:
			EloFile.write("\nPlayerID="+ str(playerID) + ";Elo="+str(Elo))
		return
	with open("C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt","r",encoding="utf-8") as EloFile:
		#print("Opened File as String")
		data = EloFile.readlines()
		#print(data)
	i = 0	
	for line in data:
		if ("PlayerID="+str(playerID)) in line:
			line = "PlayerID="+ str(playerID) + ";Elo="+str(Elo)+"\n"
			data[i] = line
			#print("Modified String")
			break
		i+=1	
	#print(data)		
	with open("C:\\Users\\Jakob\\Projects\\csgogamble\\EloTable.txt","w",encoding="utf-8") as EloFile:
		#print("Wrote String to file")
		EloFile.writelines(data)		

def testEloBaba():
	print("ALARM")
							
def calcRoundElo(team0,team1,winner):
	#@Param: team0, team1 is a List of all Players on the Team.
	# *** The List team0 has to be a List of 5 PlayerIDs! ***
	#@Param: winner is either a 0 or a 1 depending on which Team won the round.
	#This Method then calculates the Elo Values for every player after the Round and returns them in Two Lists
	K = 128

	averageEloTeam0 = -1
	averageEloTeam1 = -1
	for player in team0: averageEloTeam0 += getEloForPlayer(player)
	averageEloTeam0 = averageEloTeam0/len(team0)
	for player in team1: averageEloTeam1 += getEloForPlayer(player)
	averageEloTeam1 = averageEloTeam1/len(team0)

	for player in team0:
		elo = getEloForPlayer(player)
		#print("ELO: " + str(elo))
		transformedElo = math.pow(10, elo/400)
		#print("transformedElo: " + str(transformedElo))
		expectedScore = transformedElo/(transformedElo+math.pow(10, averageEloTeam1/400))
		#print("Expected Score: " + str(expectedScore))
		if winner == 1:
			newRating = elo + (K*(0-expectedScore))
		elif winner == 0:	
			newRating = elo + (K*(1-expectedScore))
		#print(str(player) + "  " +str(newRating))
		updateEloRating(player, newRating)	

	for player in team1:
		elo = getEloForPlayer(player)
		transformedElo = math.pow(10, elo/400)
		expectedScore = transformedElo/(transformedElo+math.pow(10, averageEloTeam0/400))
		if winner == 0:
			newRating = elo + (K*(0-expectedScore))
		elif winner == 1:
			newRating = elo + (K*(1-expectedScore))
		#print(str(player) + "  " +str(newRating))	
		updateEloRating(player, newRating)	

def calcEloOnDataset():
	with open("C:\\Users\\Jakob\\Projects\\csgogamble\\config.txt","r",encoding="utf-8") as configFile:
		config = configFile.readlines()
		lastgameID = None
		for line in config:
			if "lastgameID=" in line:
				lastgameID = str(line.rstrip().split("=")[1])
				print("lastgameID = " + str(lastgameID))					
	team1 = []
	team2 = []
	index = 0
	for line in open("C:\\Users\\Jakob\\Projects\\csgogamble\\data.csv",encoding="utf-8").readlines():
		spline = line.split(";")
		if len(spline) is not 11:
			#print("continued")
			continue
		playerID = spline[1]
		team = spline[2]
		gameID = spline[3]
		if index == 0: currentLastGame = gameID
		index += 1
		#print("Current Game Id=" + str(gameID))
		team1ID = spline[6]
		team2ID = spline [7]
		if lastgameID is None: return
		if str(lastgameID) == str(gameID):
			with open("C:\\Users\\Jakob\\Projects\\csgogamble\\config.txt","w",encoding="utf-8") as configFile:
				configFile.write("lastgameID="+str(currentLastGame))
			return	
		if lastgameID is not gameID:
			if team == "1":	team1.append(playerID)
			if team == "2": team2.append(playerID)
			#print(team2)
			if int(len(team1))+int(len(team2)) == 10:
				winnerlist = getRounds(gameID)
				#print(team1)
				#print(team2)
				#print(winnerlist)
				print("Calculating Elo for Game Number: " + str(index/10))
				for winner in winnerlist:
					calcRoundElo(team1,team2,winner)
				team1 = []
				team2 = []

#rounds = getRounds(gameID)
#rounds is filled with 1 or 0 depending on which team won. The Minimum Length of rounds is 16
#if the Game had a Score of 16-0.

def predictGame(team0,team1):
	#Gives a Winpercentage of each team based on the ELoValues in the Database.
	averageEloTeam0 = -1
	averageEloTeam1 = -1
	for player in team0: averageEloTeam0 += getEloForPlayer(player)
	averageEloTeam0 = averageEloTeam0/len(team0)
	for player in team1: averageEloTeam1 += getEloForPlayer(player)
	averageEloTeam1 = averageEloTeam1/len(team0)
	transformedEloTeam0 = math.pow(10, averageEloTeam0/400)
	transformedEloTeam1 = math.pow(10, averageEloTeam1/400)
	expectedScoreTeam0 = transformedEloTeam0/(transformedEloTeam0+math.pow(10, averageEloTeam1/400))
	print("Predicted Winrate for Team1: " + str(expectedScoreTeam0)[2:4]+"%")
	expectedScoreTeam1 = transformedEloTeam1/(transformedEloTeam1+math.pow(10, averageEloTeam0/400))
	print("Predicted Winrate for Team2: " + str(expectedScoreTeam1)[2:4]+"%")
	return str(expectedScoreTeam0)[2:4],str(expectedScoreTeam1)[2:4]




testgame = "https://www.hltv.org/matches/2325382/euronics-vs-smoke-criminals-esea-mdl-season-28-europe"

team1 = [735,334,964,8528,8789]
team2 = [339,2131,8716,8574,10449]

#predictGame(team1,team2)

calcEloOnDataset()

# testteam0 = [1001,1002,1003,1004,1005]
# testteam1 = [2001,2002,2003,2004,2005]

# winnerlist = [0,1,1,1,1,1,1,1,0,0,1,1,0,0,1,0,0,0,1,0,0,1,1,1,1,1]
# predictGame(testteam0,testteam1)
# for winner in winnerlist:
# 	print(winner)
# 	calcRoundElo(testteam0,testteam1,winner)
# for i in range(10):
# 	calcRoundElo(testteam0,testteam1,0)
# for i in range(16):
# 	calcRoundElo(testteam0,testteam1,1)	
#calcRoundElo(testteam0,testteam1,0)


# elo = getEloForPlayer(2357)
# print(elo)
