import OddsScraper

link_list OddsScraper.findMatchLinks(OddsScraper.getRawData("https://www.hltv.org/matches"))

for link in link_list:
	OddsScraper.analyzeUpcomingMatch(link)

	

