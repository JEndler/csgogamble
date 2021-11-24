## PredictionHandler Notes

- Use Trueskill Rating as proxy for players in ML Model
- 80/20 Split Training/Testing
- Features:
	- Trueskill Ratings
	- one-hot-encoded TeamID
	- winrate in last x matches
	- winrate on map
	- hltv-rating of players?
	- maybe one-hot-encode players?
	- time_since_last_game
	- kda_of_players
	- hs_ratio_of_players
