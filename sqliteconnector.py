import sqlite3
import operator
 
#config-----------
 
const = 0.04
Significantdiff = 0 #any value >= 0 , is the minimum difference of Predicted TeamStrengths at which Predictions are counted
prnt = False
ModelTest = False
 
 
 
#config-----------
 
 
 
 
conn = sqlite3.connect('Data.db',timeout=10)
c = conn.cursor()
c.execute("SELECT team1,team2,Points1,Points2 FROM Matches")
Games = c.fetchall()
if ModelTest:
    Test = Games[:100]
    Games = Games[100:]
Games  = Games[::-1]
 
c.execute("SELECT DISTINCT team1 FROM (SELECT team2 AS team1 FROM Matches UNION SELECT team1 From Matches)")
Teams = c.fetchall()
 
StrengthDict = {}
for t in Teams:
    StrengthDict[t[0]] = 0
 
for Game in Games:
    StrengthDict[Game[0]] = StrengthDict[Game[0]]+const*((Game[2]-Game[3])-(StrengthDict[Game[0]]-StrengthDict[Game[1]]))
    StrengthDict[Game[1]] = StrengthDict[Game[1]]+const*(-(Game[2]-Game[3])-(StrengthDict[Game[1]]-StrengthDict[Game[0]]))
 
#for Team in StrengthDict:
#   print(Team+" : "+str(StrengthDict[Team]))
 
 
if ModelTest:
    Right = 0
    Wrong = 0
    for Game in Test:
        if prnt:
            print("_____________________")
            print(Game)
            print("Outcome Difference")
            print(Game[2]-Game[3])
            print("Predicted Difference")
            print(StrengthDict[Game[0]]-StrengthDict[Game[1]])
            print("")
        if abs(StrengthDict[Game[0]]-StrengthDict[Game[1]])>Significantdiff:
            if (Game[2]-Game[3])*(StrengthDict[Game[0]]-StrengthDict[Game[1]])>0:
                if prnt:
                    print("Result was predicted Correct")
                Right += 1
            else:
                if prnt:
                    print("Result was Predicted Incorrect")
                Wrong += 1
    print("==========")
    print("number off correct predictions:")
    print(Right)
    print("number off incorrect predictions:")
    print(Wrong)
else:
    t2 = str(input("Enter Team1--"))
    t1 = str(input("Enter Team2--"))
    print("")
    print("The strength of "+t1+" is :" + str(StrengthDict[t1]))
    print("The strength of "+t2+" is :" + str(StrengthDict[t2]))
    print("")
    print("=========================================================================")
    if StrengthDict[t1]>StrengthDict[t2]:
        print("The Predicted Winner is: -- " + t1 + " --  with a strength difference of : "  + str(StrengthDict[t1]-StrengthDict[t2]))
    else:
        print("The Predicted Winner is: -- " + t2 + " --  with a strength difference of : " +  str(StrengthDict[t2]-StrengthDict[t1]))
 
    print("=========================================================================")
conn.close  