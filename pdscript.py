import pandas as pd
import math
import numpy as np
import matplotlib.pyplot as plt


#This creates a Dataframe using the Data from the data.csv file.
#The Param "sep=";"" sets ; as the seperator
#The Param "error_bad_lines=False" makes the Constructor skip all lines that create an error
#The "header=None" and "names=[...]" specify that there are no Headers in the File and set new Headers to be used.
data = pd.read_csv("data.csv",sep=";", header=None, error_bad_lines=False,
					names=["Player_Name","Player_ID","Team","Game_ID","Team1_Name","Team2_Name","Team1_ID","Team2_ID","Team1_Score","Team2_Score","Date_of_Game"])


print(data.head())
print(data.tail(10))
print(data["Player_Name"])