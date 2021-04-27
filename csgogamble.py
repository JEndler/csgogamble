import predictionHandler as pH
import OddsScraper
import proxyManager as pM
from bs4 import BeautifulSoup as soup
from csgocrawler import _analyseTeamTable
from dbConnector import dbConnector


class csgogamble():
    def __init__(self):
        self.predictions = pH.predictionHandler()
        self.odds = OddsScraper.loadOdds()
        self.proxies = pM.ProxyManager(debug=False, validateProxies=False)
        self.db = dbConnector()

    # This Method uses the Kelly Kriterion to Determine the Optimum Bet Size based on Odds
    def Kelly(self, odds_team1win, prediction_team1win):
        # This will be the Fraction to bet
        f = 0
        # Always the Odds for Team1 to win
        b = odds_team1win - 1
        # Always the Pred for Team1 to win
        p = prediction_team1win

        # f * is the fraction of the current bankroll to wager, i.e. how much to bet;
        # b is the net odds received on the wager ("b to 1"); that is, you could win $b (on top of getting back your $1 wagered) for a $1 bet
        # p is the probability of winning;
        f = (p * (b + 1) - 1) / b

        return f

    # Pulls all necessary Data from url and returns predicted Winrates
    def predictGameByUrl(self, url):
        page_html = self.proxies.proxiedRequest(url)
        page_soup = soup(page_html)
        teamtables = page_soup.find_all("div", {"class": "players"})

        team1ID = teamtables[0].find("a", {"class": "teamName team"})["href"].split("/")[2]
        team2ID = teamtables[1].find("a", {"class": "teamName team"})["href"].split("/")[2]

        team1playerStats = _analyseTeamTable(teamtables[0], team1ID)
        team2playerStats = _analyseTeamTable(teamtables[1], team2ID)

        team1, team2 = [item["playerID"] for item in team1playerStats], [item["playerID"] for item in team2playerStats]
        print(team1)
        print(team2)

        return self.predictions.predict(team1, team2)

    def predictGameByGameID(self, gameID):
        gameID = self.db.getGameID(gameID)
        data = self.db._getPredictiondata(gameID)
        return self.predictions.predict(data[data["team1"]], data[data["team2"]])

    def getOddsAsPercentage(self, gameID, provider="gg.bet"):
        matchID = self.db.getMatchID(gameID)
        odds = next((item[provider] for item in self.odds if item["gameID"] == str(matchID)), None)
        win_probability = round((1 / float(odds[0])), 2)
        return (win_probability, round((1 - win_probability), 2))

    def getOdds(self, gameID, provider="gg.bet"):
        matchID = self.db.getMatchID(gameID)
        odds = next((item[provider] for item in self.odds if item["gameID"] == str(matchID)), None)
        return (float(odds[0]), float(odds[1]))

    def _loadData(self, gameID):
        predictedOdds = self.predictGameByGameID(gameID)
        actualOdds = self.getOdds(gameID)
        pass

    def _debug(self, s):
        if self.debug: print("csgogamle: " + str(s))


def main():
    cs = csgogamble()
    print(cs.predictGameByGameID(96474))
    print(cs.getOdds(96474))
    print(cs.Kelly(cs.predictGameByGameID(96474)[0], cs.getOdds(96474)[0]))
    print(cs.Kelly(cs.predictGameByGameID(96474)[1], cs.getOdds(96474)[1]))


if __name__ == "__main__":
    main()
