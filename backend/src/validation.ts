import { z } from 'zod';
import { VALIDATION } from './config';

const usernameSchema = z
  .string()
  .trim()
  .min(VALIDATION.USERNAME_MIN, 'username is required')
  .max(VALIDATION.USERNAME_MAX, `username must be at most ${VALIDATION.USERNAME_MAX} characters`);

const emailSchema = z
  .string()
  .trim()
  .min(1, 'email is required')
  .max(VALIDATION.EMAIL_MAX, `email must be at most ${VALIDATION.EMAIL_MAX} characters`)
  .email('invalid email format');

const passwordSchema = z
  .string()
  .min(VALIDATION.PASSWORD_MIN, `password must be at least ${VALIDATION.PASSWORD_MIN} characters`)
  .max(VALIDATION.PASSWORD_MAX, `password must be at most ${VALIDATION.PASSWORD_MAX} characters`)
  .regex(/[A-Za-z0-9]/, 'password must include at least one letter')
  ;

const registerBodySchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

const loginBodySchema = z.object({
  username: usernameSchema.or(emailSchema),
  password: z.string().min(1, 'password is required').max(VALIDATION.PASSWORD_MAX, `password must be at most ${VALIDATION.PASSWORD_MAX} characters`),
});

const spacenameSchema = z
  .string()
  .trim()
  .min(VALIDATION.SPACENAME_MIN, 'spacename is required')
  .max(VALIDATION.SPACENAME_MAX, `spacename must be at most ${VALIDATION.SPACENAME_MAX} characters`)
  .regex(/^[\w\- ]+$/, 'spacename can only contain letters, numbers, spaces, underscores, and hyphens');

const contentHashesSchema = z.array(
  z
    .string()
    .trim()
    .regex(new RegExp(`^[a-fA-F0-9]{${VALIDATION.CONTENT_HASH_HEX_LEN}}$`), 'each content hash must be a 64-character hex string')
    .nullable(),
);

const parseSchema = <T>(schema: z.ZodType<T>, input: unknown): { success: true; data: T } | { success: false; error: string } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { success: false, error: first?.message ?? 'Invalid input' };
  }
  return { success: true, data: parsed.data };
};

export const validateRegisterBody = (body: unknown) => parseSchema(registerBodySchema, body);
export const validateLoginBody = (body: unknown) => parseSchema(loginBodySchema, body);
export const validateSpacename = (spacename: unknown) => parseSchema(spacenameSchema, spacename);
export const validateContentHashes = (hashes: unknown) => parseSchema(contentHashesSchema, hashes);
