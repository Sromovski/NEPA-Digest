import 'dotenv/config';
import { migrate } from './db';
import { seedFromFiles } from './seed';

migrate();
seedFromFiles();
