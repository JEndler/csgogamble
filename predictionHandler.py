"""
@Author: Jakob Endler
This File is responsible for handling the Predictions of csgo-Matches
It defines Classes for several Algorithms to handle Data-Storage and Calulations
the following Algorithms are used to carry out predictions.
ALgorithms used:
 -Elo
 -TrueSkill
 """

import trueskill
import itertools
import math
import sqlite3
import pickle
import os.path
import dbConnector


class TrueskillHandler():
    """
    This Class is responsible for handling the TrueSkill-Predictions
    """
    conn = None
    DB_FILEPATH = None
    CONFIG_PATH = None

    def __init__(self, DB_FILEPATH="data/trueskill.db", CONFIG_PATH="data/trueskill.conf"):
        assert os.path.exists(CONFIG_FILEPATH), "No Config File found"
        assert os.path.exists(DB_FILEPATH), "No Database File found"
        self.DB_FILEPATH = DB_FILEPATH
        self.CONFIG_PATH = CONFIG_PATH
        self.conn = sqlite3.connect(self.DB_FILEPATH)

    def _load_config(self):
        with open(self.CONFIG_PATH, "r") as configfile:
            return configfile.readline().split("=")[1].strip()

    def createDatabase(self):
        c = self.conn.cursor()
        command = """
            CREATE TABLE IF NOT EXISTS Players (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            HLTVID INTEGER NOT NULL UNIQUE,
            rating BLOB NOT NULL
            );
        """
        c.executescript(command)
        c.close()
        self.conn.commit()

    def loadData(self, gameID):
        connection = dbConnector()
        data = connection._getPredictiondata(gameID)
        connection.close_connection()
        return data

    def get_rating(self, playerID):
        c = self.conn.cursor()
        try:
            c.execute("SELECT rating FROM Players WHERE HLTVID = ?", (playerID,))
            rating = pickle.loads(c.fetchone()[0])
        except Exception as e:
            print(e)
            c.close()
            return None
            c.close()
        return rating

    def _initialize_player(self, playerID):
        c = self.conn.cursor()
        try:
            env = trueskill.TrueSkill()
            print(env)
            new_rating = env.create_rating()
            print(new_rating)
            rating_blob = pickle.dumps(new_rating, pickle.HIGHEST_PROTOCOL)
            print(rating_blob)
            tpl = (str(playerID), rating_blob)
            c.execute("INSERT INTO Players (HLTVID, rating) VALUES (?,?)", tpl)
        except Exception as e:
            print("Something went wrong when creating the Player Rating for Player: " + str(playerID))
            print("Error Message:" + str(e))
        finally:
            c.close()
            self.conn.commit()

    def set_rating(self, playerID, rating):
        curr = self.conn.cursor()
        pdata = pickle.dumps(rating, pickle.HIGHEST_PROTOCOL)
        curr.execute("UPDATE Players SET rating = ? WHERE HLTVID = ?", (playerID, sqlite3.Binary(pdata)))

    def win_probability(self, team1, team2):
        delta_mu = sum(r.mu for r in team1) - sum(r.mu for r in team2)
        sum_sigma = sum(r.sigma ** 2 for r in itertools.chain(team1, team2))
        size = len(team1) + len(team2)
        denom = math.sqrt(size * (BETA * BETA) + sum_sigma)
        ts = trueskill.global_env()
        return ts.cdf(delta_mu / denom)

    def modify_rating(self, team1, team2, winnner):
        assert isinstance(team1, list) and isinstance(team2, list), "Teams need to be a list"
        assert len(team1) == 5 and len(team2) == 5, "Teams need to be exactly 5 players each"


def main():
    TH = TrueskillHandler()
    TH.createDatabase()
    print(TH.loadData(1))
    TH._initialize_player(7710)
    print(TH.get_rating(7710))
    print(TH._load_config())


if __name__ == "__main__":
    main()
