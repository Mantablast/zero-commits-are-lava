import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;

const client = new DynamoDBClient({});

export type CacheEntry = {
  payload: string;
  fetchedAt: number;
  expiresAt: number;
};

export const getCacheEntry = async (cacheKey: string): Promise<CacheEntry | null> => {
  if (!TABLE_NAME) return null;
  const response = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ cacheKey }),
      ConsistentRead: false,
    })
  );
  if (!response.Item) return null;
  const item = unmarshall(response.Item) as CacheEntry & { cacheKey: string };
  return item;
};

export const putCacheEntry = async (cacheKey: string, entry: CacheEntry): Promise<void> => {
  if (!TABLE_NAME) return;
  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ cacheKey, ...entry }),
    })
  );
};
