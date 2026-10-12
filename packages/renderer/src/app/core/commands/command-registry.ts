import { Injectable } from '@angular/core';
import { CommandList } from './command-list';

/** Injectable wrapper; all behaviour lives in the decorator-free CommandList. */
@Injectable({ providedIn: 'root' })
export class CommandRegistry extends CommandList {}
