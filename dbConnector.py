"""
@Author: Jakob Endler
This Class is responsible for handling the Database Interactions
It uses sqlite3 to store and retrieve Data that will later be used
by the Elo-Algorithm and the DNNClassifier
"""
import sqlite3
import datetime


class dbConnector():
	conn = None
	DB_FILEPATH = "data/csgodata.db"

	def __init__(self):
		self.conn = sqlite3.connect(self.DB_FILEPATH)

	def createDatabase(self):
		c = self.conn.cursor()
		command = """
		CREATE TABLE IF NOT EXISTS Matches (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			date TEXT,
			HLTVID INTEGER NOT NULL UNIQUE,
			team1ID INTEGER,
			team2ID INTEGER,
			team1Name TEXT,
			team2Name TEXT,
			scraped_at TEXT,
			link TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS Games (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			map TEXT,
			matchID INTEGER NOT NULL,
			scoreTeam1 INTEGER NOT NULL,
			scoreTeam2 INTEGER NOT NULL,
			individualRoundWins TEXT,
			link TEXT NOT NULL,
			killmatrix BLOB,
			HLTVID INTEGER UNIQUE,
			FOREIGN KEY (matchID) REFERENCES Matches(ID)
		);

		CREATE TABLE IF NOT EXISTS Players (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			HLTVID INTEGER UNIQUE,
			playerName TEXT
		);

		CREATE TABLE IF NOT EXISTS Teams (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT,
			HLTVID INTEGER UNIQUE,
			currentPlayerIDs TEXT,
			lastRosterChange TEXT
		);

		CREATE TABLE IF NOT EXISTS PlayerGameStats (
			playerID INTEGER,
			gameID INTEGER,
			kills INTEGER,
			deaths INTEGER,
			ADR REAL,
			rating REAL,
			teamID INTEGER,
			PRIMARY KEY (playerID, gameID),
			FOREIGN KEY (teamID) REFERENCES Teams(ID),
			FOREIGN KEY (playerID) REFERENCES Players(ID),
			FOREIGN KEY (gameID) REFERENCES Games(ID)
		);
		"""
		c.executescript(command)
		c.close()
		self.conn.commit()

	def close_connection(self):
		self.conn.close()

	def _updateMatchTable(self, team1ID: int, team2ID: int, date, link: str, HLTVID: int, team1Name: str = None, team2Name: str = None, scraped_at: str =str(datetime.datetime.now())):
		c = self.conn.cursor()
		tpl = (date, HLTVID, team1ID, team2ID,
					 team1Name, team2Name, scraped_at, link)
		c.execute("""
		INSERT INTO Matches 
		(date, HLTVID, team1ID, team2ID, team1Name, team2Name, scraped_at, link)
		VALUES (?,?,?,?,?,?,?,?)
		""", tpl)
		c.close()
		self.conn.commit()

	def _updateGameTable(self, map: str, matchID: int, scoreTeam1: int, scoreTeam2: int, link: str, HLTVID: str, individualRoundWins: str = None, killmatrix=None):
		c = self.conn.cursor()
		tpl = (map, matchID, scoreTeam1, scoreTeam2,
					 individualRoundWins, link, killmatrix, HLTVID)
		c.execute("""
			INSERT INTO Games 
			(map, matchID,scoreTeam1, scoreTeam2, individualRoundWins, link, killmatrix, HLTVID)
			VALUES (?,?,?,?,?,?,?,?)
		""", tpl)
		c.close()
		self.conn.commit()

	def _updatePlayerTable(self, HLTVID: int, playerName: str):
		c = self.conn.cursor()
		tpl = (HLTVID, playerName)
		try:
			c.execute("""
				INSERT INTO Players (HLTVID, playerName)
				VALUES (?,?)
			""", tpl)
		except Exception as e:
			print("ERROR: Player with ID: " + str(HLTVID) + " and Name: " + playerName + " could not be added.")  
		finally:
			c.close()
			self.conn.commit()

	def _updateTeamsTable(self, Name: str, HLTVID: int, currentPlayerIDs: str):
		c = self.conn.cursor()
		c.execute("""
			SELECT currentPlayerIDs FROM Teams WHERE HLTVID = ?
		""", (HLTVID, ))
		if c.fetchone() == None:
			c.execute("""
				INSERT INTO Teams (Name, HLTVID, currentPlayerIDs, lastRosterChange)
				VALUES (?,?,?,?)
			""", (Name, HLTVID, currentPlayerIDs,str(datetime.datetime.now())))
		elif currentPlayerIDs == c.fetchone():
			pass
		else:
			c.execute("""
				UPDATE Teams SET currentPlayerIDs=? , lastRosterChange=?
				WHERE HLTVID = ?
			""", (currentPlayerIDs,str(datetime.datetime.now()), HLTVID))
		c.close()
		self.conn.commit()

	def _updatePlayerGameStatsTable(self, playerID: int, gameID: int, kills: int, deaths: int, ADR: float, rating: float, teamID: int):
		c = self.conn.cursor()
		tpl = (playerID, gameID, kills, deaths, ADR, rating, teamID)
		c.execute("""
			INSERT INTO PlayerGameStats 
			(playerID, gameID, kills, deaths, ADR, rating, teamID)
			VALUES (?,?,?,?,?,?,?)
		""", tpl)
		c.close()
		self.conn.commit()

	def updateData(matchData: dict, gameData: list, playerData: list, Teams: tuple):
		pass


def main():
	connection = dbConnector()
	connection.createDatabase()
	connection.close_connection()
	print("Success")


if __name__ == "__main__":
	main()
