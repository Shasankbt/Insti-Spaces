import { storage } from '../storage';
import { SpaceItemService } from './SpaceItemService';

export { SpaceItemService };

export const spaceItemService = new SpaceItemService(storage);
