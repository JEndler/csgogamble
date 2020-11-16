import predictionHandler as pH
import OddsScraper


class csgogamble():
    def __init__(self):
        self.Trueskill_Predictions = pH.TrueskillHandler()
        self.odds = OddsScraper.loadOdds()

    # This Method uses the Kelly Kriterion to Determine the Optimum Bet Size based on Odds
    def Kelly(self, url):
        # This will be the Fraction to bet
        f = 0
        # Always the Odds for Team1 to win
        b = OddsScraper.analyseUpcomingMatch(url)[0] - 1
        # Always the Pred for Team1 to win
        p = self.predictions.predictGame(url)

        # f * is the fraction of the current bankroll to wager, i.e. how much to bet;
        # b is the net odds received on the wager ("b to 1"); that is, you could win $b (on top of getting back your $1 wagered) for a $1 bet
        # p is the probability of winning;
        f = (p(b + 1) - 1) / b

        print(f)


def main():
    cs = csgogamble()
    print(cs.Kelly())


if __name__ == "__main__":
    main()
