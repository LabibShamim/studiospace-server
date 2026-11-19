import express from 'express'
import { MongoClient } from 'mongodb';
import 'dotenv/config'
import cors from 'cors'
const app = express()
app.use(cors());
app.use(express.json());
const port = 5000

const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB();

const db = mongoClient.db('studiospace');
const studiospaceCollection = db.collection('Studios');

app.post('/add-studio',async (req, res) => {
  const data = req.body;
  const result = await studiospaceCollection.insertOne(data);
  console.log(result);

  res.send(result);
})


app.get('/Studios', async (req, res) => {
  const result = await studiospaceCollection.find().toArray();
  res.send(result);
});


app.get('/', (req, res) => {
  res.send({ message: 'Hello World!' })
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
