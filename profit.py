import HLTVScraper
import OddsScraper


#This Method uses the Kelly Kriterion to Determine the Optimum Bet Size based on Odds
def Kelly(url):
	f = 0 #This will be the Fraction to bet

	#Always the Odds for Team1 to win
	b = OddsScraper.analyseUpcomingMatch(url)[0] - 1

	#Always the Pred for Team1 to win
	p = HLTVScraper.predictGame(url)[1]

	# f * is the fraction of the current bankroll to wager, i.e. how much to bet;
	# b is the net odds received on the wager ("b to 1"); that is, you could win $b (on top of getting back your $1 wagered) for a $1 bet
	# p is the probability of winning;
	f = (p(b+1)-1)/b

	print(f)



url = "https://www.hltv.org/matches/2332200/cloud9-vs-faze-blast-pro-series-miami-2019"

Kelly(url)
