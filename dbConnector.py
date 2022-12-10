"""
@Author: Jakob Endler
This Class is responsible for handling the Database Interactions
It uses sqlite3 to store and retrieve Data that will later be used
by the Elo-Algorithm and the DNNClassifier
"""
import sqlite3
import datetime
import psycopg2

# TODO: Connect to real Log-File
def errorlog(errorstring):
    print(errorstring) 

class dbConnector():
    DB_FILEPATH = "data/csgodata.db"

    def __init__(self, type="sqlite3"):
        if type == "sqlite3":
            self.conn = sqlite3.connect(self.DB_FILEPATH)
        if type == "psql":
            self.conn = psycopg2.connect("dbname='jakob' user='jakob' host='localhost' password=''")

    def createDatabase(self):
        c = self.conn.cursor()
        command = """
        CREATE TABLE IF NOT EXISTS Matches (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            HLTVID INTEGER NOT NULL UNIQUE,
            team1ID INTEGER,
            team2ID INTEGER,
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
            HLTVID INTEGER UNIQUE,
            team1IDs TEXT,
            team2IDs TEXT,
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
        
        CREATE TABLE IF NOT EXISTS Odds (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            HLTVID INTEGER,
            game_link TEXT,
            provider_link TEXT,
            odds_team1 REAL,
            odds_team2 REAL,
            scraped_at TEXT
        );
        
        """
        c.executescript(command)
        c.close()
        self.conn.commit()

    def close_connection(self):
        self.conn.close()

    def updateMatchTable(self, team1ID: int, team2ID: int, date, link: str, HLTVID: int, scraped_at: str = str(datetime.datetime.now())):
        c = self.conn.cursor()
        tpl = (date, HLTVID, team1ID, team2ID,
               scraped_at, link)
        try:
            c.execute("""
            INSERT INTO Matches
            (date, HLTVID, team1ID, team2ID, scraped_at, link)
            VALUES (?,?,?,?,?,?)
            """, tpl)
        except Exception:
            pass
            # errorlog("ERROR: Match with ID: " + str(HLTVID) + " could not be added.")
        finally:
            c.close()
            self.conn.commit()
            
    def updateOddsTable(self, HLTVID: int, game_link: str, provider_link: str, odds_team1: float, odds_team2: float, scraped_at: str = str(datetime.datetime.now())):
        c = self.conn.cursor()
        tpl = (HLTVID, game_link, provider_link, odds_team1, odds_team2, scraped_at)
        try:
            c.execute("""
                INSERT INTO Odds
                (HLTVID, game_link, provider_link, odds_team1, odds_team2, scraped_at)
                VALUES (?,?,?,?,?,?)
            """, tpl)
        except Exception:
            errorlog("ERROR: Odds for Game with ID: " + str(HLTVID) + " could not be added.")
        c.close()
        self.conn.commit()

    def updateGameTable(self, map: str, matchID: int, scoreTeam1: int, scoreTeam2: int, link: str, HLTVID: str, individualRoundWins: str = "", team1IDs: str = "", team2IDs: str = ""):
        c = self.conn.cursor()
        tpl = (map, matchID, scoreTeam1, scoreTeam2,
               individualRoundWins, link, HLTVID, team1IDs, team2IDs)
        try:
            c.execute("""
                INSERT INTO Games
                (map, matchID, scoreTeam1, scoreTeam2, individualRoundWins, link, HLTVID, team1IDs, team2IDs)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, tpl)
        except Exception as e:
            errorlog("ERROR: Game with ID: " + str(HLTVID) + " could not be added.")
            print(e)
        finally:
            c.close()
            self.conn.commit()

    def updatePlayerTable(self, HLTVID: int, playerName: str):
        c = self.conn.cursor()
        tpl = (HLTVID, playerName)
        try:
            c.execute("""
                INSERT INTO Players (HLTVID, playerName)
                VALUES (?,?)
            """, tpl)
        except Exception:
            pass
            # errorlog("ERROR: Player with ID: " + str(HLTVID) + " and Name: " + playerName + " could not be added.")
        finally:
            c.close()
            self.conn.commit()

    def updateTeamsTable(self, Name: str, HLTVID: int, currentPlayerIDs: str):
        # currentPlayerIDs MUST be a SORTED string like 123;234;345;567;896
        c = self.conn.cursor()
        c.execute("""
            SELECT currentPlayerIDs FROM Teams WHERE HLTVID = ?
        """, (HLTVID, ))
        if c.fetchone() is None:
            c.execute("""
                INSERT INTO Teams (Name, HLTVID, currentPlayerIDs, lastRosterChange)
                VALUES (?,?,?,?)
            """, (Name, HLTVID, currentPlayerIDs, str(datetime.datetime.now())))
        elif currentPlayerIDs == c.fetchone():
            pass
        else:
            c.execute("""
                UPDATE Teams SET currentPlayerIDs=? , lastRosterChange=?
                WHERE HLTVID = ?
            """, (currentPlayerIDs, str(datetime.datetime.now()), HLTVID))
        c.close()
        self.conn.commit()

    def updatePlayerGameStatsTable(self, playerID: int, gameID: int, kills: int, deaths: int, ADR: float, rating: float, teamID: int):
        c = self.conn.cursor()
        tpl = (playerID, gameID, kills, deaths, ADR, rating, teamID)
        c.execute("""
            INSERT INTO PlayerGameStats
            (playerID, gameID, kills, deaths, ADR, rating, teamID)
            VALUES (?,?,?,?,?,?,?)
        """, tpl)
        c.close()
        self.conn.commit()

    def getLastMatchID(self):
        c = self.conn.cursor()
        c.execute("SELECT MAX(HLTVID) FROM MATCHES")
        return c.fetchone()

    def getGameID(self, HLTVID):
        c = self.conn.cursor()
        c.execute("SELECT ID FROM GAMES WHERE HLTVID = ?", (HLTVID,))
        return c.fetchone()[0]

    def loadGamesUntilDay(self, Day):
        c = self.conn.cursor()
        c.execute("SELECT GAMES.ID FROM GAMES JOIN MATCHES ON GAMES.MATCHID=MATCHES.HLTVID WHERE MATCHES.DATE < ? AND GAMES.INDIVIDUALROUNDWINS != '-1'", (Day,))
        return [x[0] for x in c.fetchall()]

    def getMatchID(self, gameID):
        c = self.conn.cursor()
        c.execute("SELECT MATCHID FROM GAMES WHERE HLTVID = ?", (gameID,))
        return c.fetchone()[0]

    def getWinner(self, gameID):
        c = self.conn.cursor()
        c.execute("SELECT scoreTeam1, scoreTeam2 FROM GAMES WHERE HLTVID = ?", (gameID,))
        if scoreTeam1 > scoreTeam2:
            return 1
        elif scoreTeam2 > scoreTeam1:
            return 2
        else:
            return 0

    def loadNextGames(self, gameID):
        c = self.conn.cursor()
        c.execute("SELECT ID FROM GAMES WHERE ID > ?", (gameID,))
        return [x[0] for x in c.fetchall()]

    def _getPredictiondata(self, gameID):
        c = self.conn.cursor()
        # Needed Team1: [], Tean2: [], IndividualRoundWins: []
        c.execute("SELECT playerID, teamID FROM PlayerGameStats WHERE gameID = ?", (gameID, ))
        players = c.fetchall()
        data = {}
        data["gameID"] = gameID
        for player in players:
            if player[1] in data:
                data[player[1]].append(player[0])
            else:
                data[player[1]] = [player[0]]
        c.execute("SELECT matchID FROM Games WHERE ID = ?", (gameID, ))
        data["matchHLTVID"] = c.fetchone()[0]
        c.execute("SELECT team1ID, team2ID, link FROM Matches WHERE HLTVID = ?", (data["matchHLTVID"], ))
        teams = c.fetchone()
        c.execute("SELECT map, scoreTeam1, scoreTeam2, individualRoundWins FROM Games WHERE ID = ?", (gameID, ))
        gamedata = c.fetchone()
        if gamedata[1] == gamedata[2]:
            data["winner"] = None
        elif gamedata[1] > gamedata[2]:
            data["winner"] = teams[0]
        else:
            data["winner"] = teams[1]
        data["map"] = gamedata[0]
        data["team1"] = teams[0]
        data["team2"] = teams[1]
        data["scoreTeam1"] = gamedata[1]
        data["scoreTeam2"] = gamedata[2]
        data["individualRoundWins"] = gamedata[3]
        data["link"] = teams[2]
        c.close()
        return data

    def getFeatures(self, gameID):
        """Returns Features for the GameID

        Args:
            gameID (Integer): ID present in the SQLite-Database.
        """
        pass




def main():
    connection = dbConnector(type="psql")
    connection.createDatabase()
    print(connection.getLastMatchID())
    connection.close_connection()
    print("Success")


if __name__ == "__main__":
    main()
