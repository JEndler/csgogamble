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
			HLTVID INTEGER NOT NULL,
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
			HLTVID INTEGER,
			FOREIGN KEY (matchID) REFERENCES Matches(ID)
		);

		CREATE TABLE IF NOT EXISTS Players (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			HLTVID INTEGER,
			playerName TEXT
		);

		CREATE TABLE IF NOT EXISTS Teams (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT,
			HLTVID INTEGER,
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

  def updateMatchTable(self, team1ID: int, team2ID: int, date, link: str, HLTVID: int, team1Name: str = None, team2Name: str = None, scraped_at=datetime.datetime.now()):
    
    


def main():
  connection = dbConnector()
  connection.createDatabase()
  connection.close_connection()
  print("Success")


if __name__ == "__main__":
  main()
