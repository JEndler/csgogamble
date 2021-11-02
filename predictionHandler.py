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
import ast
import time
from OddsScraper import loadOdds


class TrueskillHandler():
    """
    This Class is responsible for handling the TrueSkill-Predictions
    """

    def __init__(self, DB_FILEPATH="data/trueskill.db", CONFIG_PATH="data/trueskill.conf", debug=True):
        assert os.path.exists(CONFIG_PATH), "No Config File found"
        #assert os.path.exists(DB_FILEPATH), "No Database File found"
        self.DB_FILEPATH = DB_FILEPATH
        self.CONFIG_PATH = CONFIG_PATH
        self.lastCalculatedGame = self._load_config()
        self.conn = sqlite3.connect(self.DB_FILEPATH)
        self.debug = debug

    def _load_config(self):
        with open(self.CONFIG_PATH, "r") as configfile:
            return int(configfile.readline().split("=")[1].strip())

    def _write_to_config(self, gameID):
        with open(self.CONFIG_PATH, "w") as configfile:
            configfile.write(str("lastCalculatedGame=" + str(gameID)))

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
        connection = dbConnector.dbConnector()
        data = connection._getPredictiondata(gameID)
        connection.close_connection()
        assert data["individualRoundWins"] != '-1', "There are no IndividualRoundWins for this Match, skipping..."
        return data

    def get_rating(self, playerID):
        c = self.conn.cursor()
        try:
            c.execute("SELECT rating FROM Players WHERE HLTVID = ?", (int(playerID),))
            output = c.fetchone()
            if output is None:
                self._initialize_player(playerID)
                return self.get_rating(playerID)
            rating = pickle.loads(output[0])
        except Exception as e:
            self._debug(e)
            c.close()
            return None
        c.close()
        return rating

    def _initialize_player(self, playerID):
        c = self.conn.cursor()
        try:
            env = trueskill.TrueSkill()
            new_rating = env.create_rating()
            rating_blob = pickle.dumps(new_rating, pickle.HIGHEST_PROTOCOL)
            tpl = (str(playerID), rating_blob)
            c.execute("INSERT INTO Players (HLTVID, rating) VALUES (?,?)", tpl)
        except Exception as e:
            self._debug("Something went wrong when creating the Player Rating for Player: " + str(playerID))
            self._debug("Error Message:" + str(e))
        finally:
            c.close()
            self.conn.commit()

    def set_rating(self, playerID, rating):
        curr = self.conn.cursor()
        pdata = pickle.dumps(rating, pickle.HIGHEST_PROTOCOL)
        curr.execute("UPDATE Players SET rating = ? WHERE HLTVID = ?", (sqlite3.Binary(pdata), playerID))
        curr.close()
        self.conn.commit()

    # Teams are Lists of Rating-Objects
    # returns Winprobability for team2
    def win_probability(self, team1, team2):
        delta_mu = sum(r.mu for r in team1) - sum(r.mu for r in team2)
        sum_sigma = sum(r.sigma ** 2 for r in itertools.chain(team1, team2))
        size = len(team1) + len(team2)
        denom = math.sqrt(size * (trueskill.BETA * trueskill.BETA) + sum_sigma)
        ts = trueskill.global_env()
        return ts.cdf(delta_mu / denom)

    def _loadTeamRating(self, team):
        team_ratings = ()
        for player in team:
            team_ratings += (self.get_rating(player),)
        return team_ratings

    def _writeTeamRating(self, team, ratings):
        for player in team:
            self.set_rating(player, ratings[team.index(player)])

    def modify_rating(self, team1, team2, winner):
        assert isinstance(team1, list) and isinstance(team2, list), "Teams need to be a list"
        assert len(team1) == 5 and len(team2) == 5, "Teams need to be exactly 5 players each"
        env = trueskill.TrueSkill()
        # load players from the database
        # calculate new ratings
        rating_groups = [self._loadTeamRating(team1), self._loadTeamRating(team2)]
        if winner == 2: ranks = [0, 1]
        if winner == 1: ranks = [1, 0]
        rated_rating_groups = env.rate(rating_groups, ranks=ranks)
        # save new ratings
        self._writeTeamRating(team1, rated_rating_groups[0])
        self._writeTeamRating(team2, rated_rating_groups[1])

    def _calculateSingleMatch(self, data):

        def _cleanRoundWinsList(roundWins):
            individualRoundWins = ast.literal_eval(roundWins)
            individualRoundWins.insert(0, '0-0')
            roundWinners = []
            for Round in individualRoundWins:
                if Round == '0-0':
                    continue
                split = Round.split("-")
                prevSplit = individualRoundWins[individualRoundWins.index(Round) - 1].split("-")
                team1 = int(split[0]) - int(prevSplit[0])
                team2 = int(split[1]) - int(prevSplit[1])
                if team1 == 1:
                    roundWinners.append(1)
                if team2 == 1: roundWinners.append(2)
            return roundWinners

        roundWins = _cleanRoundWinsList(data["individualRoundWins"])
        for winnerTeam in roundWins:
            self.modify_rating(data[data["team1"]], data[data["team2"]], winnerTeam)
        self._debug("Calculated GameID: " + str(data["gameID"]))

    def _calculateMatches(self, gameIDs):
        for game in gameIDs:
            if game <= self.lastCalculatedGame:
                raise ValueError("_calculateMatches: Invalid GameID")
            try:
                data = self.loadData(game)
                self._calculateSingleMatch(data)
                self._write_to_config(game)
            except Exception as e:
                self._debug("Failed to calculate Match " + str(game) + " with Error:")
                self._debug(e)

    def predictGame(self, gameID):
        testdata = self.loadData(gameID)
        team1_id, team2_id = testdata["team1"], testdata["team2"]
        team1win = self.win_probability(self._loadTeamRating(testdata[team1_id]), self._loadTeamRating(testdata[team2_id]))
        self._debug("Probability for Team 2 to win: " + str(team1win))
        return team1win

    def _debug(self, s):
        if self.debug: print("TrueskillHandler: " + str(s))


class predictionHandler():
    def __init__(self, debug=True):
        self.TH = TrueskillHandler()
        self.DB = dbConnector.dbConnector()
        self.debug = debug

    def calcTrueskill(self):
        try:
            trainingGames = self.DB.loadNextGames(self.TH.lastCalculatedGame)
        except Exception as e:
            self._debug("No more Games to calc TrueSkill on.")
            return
        self._debug("Found " + str(len(trainingGames)) + " Games to calculate Rating.")
        self.TH._calculateMatches(trainingGames)
        self._debug("Finished Calculating Ratings on " + str(len(trainingGames)) + " Games.")

    def predict(self, team1, team2):
        # Teams are lists of PlayerIDs
        TH_prediction = self.TH.win_probability(self.TH._loadTeamRating(team1), self.TH._loadTeamRating(team2))
        TH_prediction = (round(TH_prediction, 2), round((1 - TH_prediction), 2))
        print(TH_prediction)
        return TH_prediction

    def extractFeatures(self, gameID):
        pass

    def _debug(self, s):
        if self.debug: print("predictionHandler: " + str(s))


def main():
    TH = TrueskillHandler(debug=True)

    predictions = predictionHandler()
    start = time.time()
    
    predictions.calcTrueskill()

    print("Calculating Matches took " + str(time.time() + start) + " Seconds.")

    testdata = TH.loadData(1)
    team1_id, team2_id = testdata["team1"], testdata["team2"]
    print(team1_id)
    print(TH._loadTeamRating(testdata[team1_id]))
    print(TH._loadTeamRating(testdata[team2_id]))
    print(predictions.predict(testdata[team1_id], testdata[team2_id]))
    # TH._calculateSingleMatch(TH.loadData(2777))


if __name__ == "__main__":
    main()
