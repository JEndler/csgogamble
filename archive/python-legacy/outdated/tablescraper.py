import pandas as pd
from urllib.request import urlopen
from urllib.request import Request

url = "https://www.hltv.org/stats/matches/performance/mapstatsid/59822/natus-vincere-vs-faze"
req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})

uClient = urlopen(req)
page_html = uClient.read()
uClient.close()

tables = pd.read_html(page_html)

print("#### KILL MATRIX ####")
print("All Kills")
print(tables[1].to_csv())
print("--------------------")
print("#### KILL MATRIX ####")
print("First Kills")
print(tables[2])
print("--------------------")
print("#### KILL MATRIX ####")
print("Awp Kills")
print(tables[3])
print("--------------------")

