from twilio.rest import Client
import os
import datetime

def hours_since_modification(filename = "/home/projects/csgogamble/data/odds.txt"):
  t = os.path.getmtime(filename)
  return (datetime.now() - datetime.datetime.fromtimestamp(t)).total_seconds()/60/60

if hours_since_modification() > 24:
	client = Client("AC66c0f572c83b77d8b78e6832e545c2ab", "4f7dec8ae2b64d23f959a23ae22399c7")
	client.messages.create(to="+4915141448900",from_="+18509192806",body="No Data in data/odds.txt in the last 24 Hours")
