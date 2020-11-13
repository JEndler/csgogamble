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


class TrueskillHandler():
    """
    This Class is responsible for handling the TrueSkill-Predictions
    """

    def __init__(self, DB_FILEPATH="data/trueskill.db", CONFIG_PATH="data/trueskill.conf", debug=True):
        assert os.path.exists(CONFIG_PATH), "No Config File found"
        assert os.path.exists(DB_FILEPATH), "No Database File found"
        self.DB_FILEPATH = DB_FILEPATH
        self.CONFIG_PATH = CONFIG_PATH
        self.conn = sqlite3.connect(self.DB_FILEPATH)
        self.debug = debug

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
        connection = dbConnector.dbConnector()
        data = connection._getPredictiondata(gameID)
        connection.close_connection()
        assert data["individualRoundWins"] != '-1', "There are no IndividualRoundWins for this Match, skipping..."
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
            new_rating = env.create_rating()
            rating_blob = pickle.dumps(new_rating, pickle.HIGHEST_PROTOCOL)
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
        print(str(playerID) + " - " + str(rating))
        pdata = pickle.dumps(rating, pickle.HIGHEST_PROTOCOL)
        curr.execute("UPDATE Players SET rating = ? WHERE HLTVID = ?", (sqlite3.Binary(pdata), playerID))
        curr.close()
        self.conn.commit()

    # Teams are Lists of Rating-Objects
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
        print(roundWins)
        for winnerTeam in roundWins:
            self.modify_rating(data[data["team1"]], data[data["team2"]], winnerTeam)
        if self.debug: print("Calculated GameID: " + str(data["gameID"]))


def main():
    TH = TrueskillHandler()
    TH.createDatabase()
    data = TH.loadData(2777)
    print(data)
    team1_id, team2_id = data["team1"], data["team2"]
    print("Team 1 Ratings before Match")
    print(TH._loadTeamRating(data[team1_id]))
    print("Team 2 Ratings before Match")
    print(TH._loadTeamRating(data[team2_id]))
    print("Win Probability before Match")
    print(TH.win_probability(TH._loadTeamRating(data[team1_id]), TH._loadTeamRating(data[team2_id])))
    TH._calculateSingleMatch(TH.loadData(2777))
    print("Team 1 Ratings after Match")
    print(TH._loadTeamRating(data[team1_id]))
    print("Team 2 Ratings after Match")
    print(TH._loadTeamRating(data[team2_id]))
    print("Win Probability after Match")
    print(TH.win_probability(TH._loadTeamRating(data[team1_id]), TH._loadTeamRating(data[team2_id])))


if __name__ == "__main__":
    main()
