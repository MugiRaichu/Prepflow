import { db } from '../db';
import { makeRepo } from './base';

export const profilesRepo = makeRepo(db.profiles);
export const householdsRepo = makeRepo(db.households);
export const daySchedulesRepo = makeRepo(db.daySchedules);
export const habitsRepo = makeRepo(db.habits);
export const equipmentRepo = makeRepo(db.equipment);
export const containersRepo = makeRepo(db.containers);
export const ingredientsRepo = makeRepo(db.ingredients);
export const inventoryRepo = makeRepo(db.inventory);
export const recipesRepo = makeRepo(db.recipes);
export const weekPlansRepo = makeRepo(db.weekPlans);
export const plannedMealsRepo = makeRepo(db.plannedMeals);
export const containerAssignmentsRepo = makeRepo(db.containerAssignments);

export * from './settings';
export type { NewRecord } from './base';
