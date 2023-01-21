-- Migration number: 0003 	 2023-01-20T11:32:18.817Z
ALTER TABLE Subscriptions 
ADD connectionPoolId VARCHAR(64);