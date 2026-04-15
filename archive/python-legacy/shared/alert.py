from twilio.rest import Client
import os
import datetime
import pickle

_FILENAME = "data/alert_config.pickle"


def get_hours_since_last_runtime():
    with open(_FILENAME, 'rb') as f:
        last_runtime = pickle.load(f)
    dateTimeDifference = datetime.datetime.now() - last_runtime
    # Divide difference in seconds by number of seconds in hour (3600)
    dateTimeDifferenceInHours = dateTimeDifference.total_seconds() / 60 / 60
    return int(dateTimeDifferenceInHours)


def hours_since_modification(filename="/home/projects/csgogamble/data/odds.txt"):
    t = os.path.getmtime(filename)
    return (datetime.datetime.now() - datetime.datetime.fromtimestamp(t)).total_seconds() / 60 / 60


def execute():
    if hours_since_modification() > 24 and get_hours_since_last_runtime() > 24:
        # Legacy credentials removed during archive cleanup.
        # This module is retained for reference only and is not operational.
        raise RuntimeError("Archived legacy alert module: credentials removed")
        with open(_FILENAME, 'wb') as f:
            # Pickle the 'data' dictionary using the highest protocol available.
            pickle.dump(datetime.datetime.now(), f, pickle.HIGHEST_PROTOCOL)


if __name__ == "__main__":
    execute()
