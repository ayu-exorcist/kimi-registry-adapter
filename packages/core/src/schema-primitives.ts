import * as z from 'zod/mini';

import { modalityValues } from './model-capability-definition';
import { providerTypes } from './provider-descriptor';

export const nonEmptyStringSchema = z.string().check(z.trim(), z.minLength(1));
export const nonEmptyStringArraySchema = z.array(nonEmptyStringSchema).check(z.minLength(1));
export const positiveIntegerSchema = z.int().check(z.positive());
export const providerTypeSchema = z.enum(providerTypes);
export const modalitySchema = z.enum(modalityValues);
export type Modality = z.infer<typeof modalitySchema>;
