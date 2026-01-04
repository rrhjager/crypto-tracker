/*
  Warnings:

  - Made the column `market` on table `Favorite` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Favorite" ALTER COLUMN "market" SET NOT NULL,
ALTER COLUMN "market" SET DEFAULT '';
