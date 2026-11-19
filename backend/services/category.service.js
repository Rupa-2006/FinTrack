// Categories: system defaults for everyone plus each user's own.
const ApiError = require('../utils/ApiError');
const database = require('../config/database');
const categoryModel = require('../models/category.model');
const audit = require('./audit.service');

const { DATA } = audit.EVENT_TYPES;

const toDto = (row) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  color: row.color,
  isDefault: row.user_id === null,
  isArchived: Boolean(row.is_archived),
});

async function list(userId, filters) {
  return (await categoryModel.listVisible(userId, filters)).map(toDto);
}

async function assertNameFree(userId, name, type, exceptId) {
  if (await categoryModel.nameTaken(userId, name, type, exceptId)) {
    throw ApiError.conflict('You already have a category with this name', [{ field: 'body.name', message: 'You already have a category with this name' }]);
  }
}

const auditEntry = (userId, action, id, ctx, details) => ({ userId, eventType: DATA, action, resourceType: 'category', resourceId: id, details, ctx });

async function create(userId, input, ctx = {}) {
  await assertNameFree(userId, input.name, input.type);
  const id = await database.withTransaction(async (tx) => {
    const newId = await categoryModel.create(userId, input, tx);
    await audit.append(tx, auditEntry(userId, 'CATEGORY_CREATED', newId, ctx, { type: input.type }));
    return newId;
  });
  return toDto(await categoryModel.findOwned(id, userId));
}

// Default categories and other users' categories are "not found" for editing.
async function update(userId, id, input, ctx = {}) {
  const existing = await categoryModel.findOwned(id, userId);
  if (!existing) throw ApiError.notFound('Category not found');
  await assertNameFree(userId, input.name, existing.type, id);
  await database.withTransaction(async (tx) => {
    await categoryModel.update(id, userId, input, tx);
    await audit.append(tx, auditEntry(userId, 'CATEGORY_UPDATED', id, ctx, { fields: ['name', 'color'] }));
  });
  return toDto(await categoryModel.findOwned(id, userId));
}

// A category that transactions or budgets still point to is archived (hidden from pickers,
// history intact); an unused one is deleted.
async function remove(userId, id, ctx = {}) {
  const existing = await categoryModel.findOwned(id, userId);
  if (!existing) throw ApiError.notFound('Category not found');
  const inUse = await categoryModel.isInUse(id);
  await database.withTransaction(async (tx) => {
    if (inUse) await categoryModel.archive(id, userId, tx);
    else await categoryModel.remove(id, userId, tx);
    await audit.append(tx, auditEntry(userId, inUse ? 'CATEGORY_ARCHIVED' : 'CATEGORY_DELETED', id, ctx));
  });
  return { outcome: inUse ? 'archived' : 'deleted' };
}

// Used by transactions and budgets: the category must be visible to the user, active and
// of the expected type.
async function requireUsable(userId, categoryId, type, field = 'body.categoryId') {
  const category = await categoryModel.findVisible(categoryId, userId);
  if (!category || category.is_archived) throw ApiError.validation([{ field, message: 'Choose one of your categories' }]);
  if (type && category.type !== type) {
    throw ApiError.validation([{ field, message: `Choose ${type === 'INCOME' ? 'an income' : 'an expense'} category` }]);
  }
  return category;
}

module.exports = { list, create, update, remove, requireUsable };
