import { Binary, Unary, VariableTerm, Quantification, Application, Lookup, PredicateLookup, And, Or, Distinct, Ite, Let, Literal, SeqRanged, SeqSingleton, SeqUpdate, SetSingleton, MultisetSingleton, SortWrapper, Term, BinaryOp, LogicalWrapper } from "./Term";
import { TranslationEnv } from "./TranslationEnv";
import { Logger } from "../logger";
import { getSort, Sort } from "./Sort";
import { DebuggerError } from "../Errors";
import { mkString } from "../util";
import { AlloyTranslator } from "./AlloyTranslator";


export interface TermVisitor<T> {
    visitBinary(binary: Binary): T;
    visitUnary(unary: Unary): T;
    visitSortWrapper(sortWrapper: SortWrapper): T;
    visitVariableTerm(variable: VariableTerm): T;
    visitQuantification(quantification: Quantification): T;
    visitApplication(application: Application): T;
    visitLookup(lookup: Lookup): T;
    visitPredicateLookup(lookup: PredicateLookup): T;
    visitAnd(and: And): T;
    visitOr(or: Or): T;
    visitDistinct(distinct: Distinct): T;
    visitIte(ite: Ite): T;
    visitLet(term: Let): T;
    visitLiteral(literal: Literal): T;
    visitSeqRanged(seqRanged: SeqRanged): T;
    visitSeqSingleton(seqSingleton: SeqSingleton): T;
    visitSeqUpdate(seqUpdate: SeqUpdate): T;
    visitSetSingleton(setSingleton: SetSingleton): T;
    visitMultiSetSingleton(multiSetSingleton: MultisetSingleton): T;

    visitLogicalWrapper(boolWrapper: LogicalWrapper): T;
}

export function sanitize(name: string) {
    return name.replace(/^\$/g, "")
               .replace(/[@[\]$]/g, "_");
}

export class Leftover {
    constructor(readonly leftover: Term, readonly reason: string, readonly other: Leftover[]) {}

    toString() {
        return this.reason + ": " + this.leftover.toString();
    }

    toStringWithChildren(indent = 0): string {
        return this.reason + ": " + this.leftover.toString() + "\n" +
            this.other.map(o => o.toStringWithChildren(indent + 1));
    }
}

export class TranslationRes {
    constructor(readonly res: string | undefined,
                readonly leftovers: Leftover[],
                readonly quantifiedVariables: string[],
                readonly additionalFacts: string[]) {}
    
    public withQuantifiedVariables(quantifiedVariables: string[]) {
        quantifiedVariables.forEach(v => this.quantifiedVariables.push(v));
        return this;
    }

    public withAdditionalFacts(additionalFacts: string[]) {
        additionalFacts.forEach(f => this.additionalFacts.push(f));
        return this;
    }
}
function translatedFrom(res: string, others: TranslationRes[]) {
    let leftovers = others.reduce((acc, curr) => acc.concat(curr.leftovers), [] as Leftover[]);
    let quantifiedVariables = others.reduce((acc, curr) => acc.concat(curr.quantifiedVariables), [] as string[]);
    let additionalFacts = others.reduce((acc, curr) => acc.concat(curr.additionalFacts), [] as string[]);

    return new TranslationRes(res, leftovers, quantifiedVariables, additionalFacts);
}

function leftover(leftover: Term, reason: string, other: Leftover[]) {
    return new TranslationRes(undefined, [new Leftover(leftover, reason, other)], [], []);
}

export class TermTranslatorVisitor implements TermVisitor<TranslationRes> {

    constructor(readonly env: TranslationEnv) {}

    private coll_call(name: string, sort: Sort, args: Term[]): TranslationRes {
        const freshName = this.env.getFreshVariable('fun_res', sort);

        const tArgs: TranslationRes[] = [];
        args.forEach(a => {
            const res = a.accept(this);
            if (res.res === undefined) {
                Logger.error("Could not translate argument: " + res);
                return leftover(a, "Could not translate argument", []);
            }
            tArgs.push(res);
        });
        
        const fun_res = freshName + " = " + name + mkString(tArgs.map(a => a.res), '[', ", ", ']');
        return translatedFrom(freshName, tArgs)
                .withAdditionalFacts([fun_res]);
    }

    private call(name: string, args: Term[]): TranslationRes {
        const tArgs: TranslationRes[] = [];
        args.forEach(a => {
            const res = a.accept(this);
            if (res.res === undefined) {
                Logger.error("Could not translate argument: " + res);
                return leftover(a, "Could not translate argument", []);
            }
            tArgs.push(res);
        });

        return translatedFrom(name + mkString(tArgs.map(a => a.res), '[', ", ", ']'), tArgs);
    }

    visitBinary(binary: Binary): TranslationRes {
        if (binary.op === "Combine") {
            return this.coll_call("combine", Sort.Snap,[binary.lhs, binary.rhs]);
        }

        const leftSort = getSort(binary.lhs);
        const rightSort = getSort(binary.rhs);

        if (leftSort.is('Set') || rightSort.is('Set')) {
            switch (binary.op) {
                case BinaryOp.SetAdd: return this.coll_call('set_add', leftSort, [binary.lhs, binary.rhs]);
                case BinaryOp.SetDifference: return this.coll_call('set_difference', leftSort, [binary.lhs, binary.rhs]);
                case BinaryOp.SetIntersection: return this.coll_call('set_intersection', leftSort, [binary.lhs, binary.rhs]);
                case BinaryOp.SetUnion: return this.coll_call('set_union', leftSort, [binary.lhs, binary.rhs]);

                case BinaryOp.SetIn: return this.coll_call('set_in', Sort.Bool, [binary.lhs, binary.rhs]);
                case BinaryOp.SetSubset: return this.coll_call('set_subset', Sort.Bool, [binary.lhs, binary.rhs]);
                case BinaryOp.SetDisjoint: return this.coll_call('set_disjoint', Sort.Bool, [binary.lhs, binary.rhs]);
            }
        }

        // Alloy operators only have one equal sign, but are otherwise the same as the Viper ones.
        let alloyOp = binary.op.replace("==", "=");

        // If the left and right terms are of Bool sort and not the result of a computation, then we need to wrap 
        // them to perform the operation
        if (leftSort.is(Sort.Bool) || rightSort.is(Sort.Bool)) {
            if (binary.op === '==>' || binary.op === 'implies' || binary.op === '==') {

                const left = leftSort.is(Sort.Bool) ? new LogicalWrapper(binary.lhs).accept(this)
                                                       : binary.lhs.accept(this);
                if (left.res === undefined) {
                    return leftover(binary, "Left-hand side operand not translated", left.leftovers);
                }

                const right = rightSort.is(Sort.Bool) ? new LogicalWrapper(binary.rhs).accept(this)
                                                         : binary.rhs.accept(this);
                if (right.res === undefined) {
                    return leftover(binary, "Right-hand side operand not translated", right.leftovers);
                }
                // if (binary.op === '==') {
                //     alloyOp = "&&";
                // }
                // if ((binary.lhs instanceof VariableTerm || binary.lhs instanceof Application || binary.lhs instanceof Lookup)
                //         && leftSort.is(Sort.Bool) {
                //     lhs = `isTrue[${left.res}]`;
                // }
                // let rhs = right.res;
                // if ((binary.rhs instanceof VariableTerm || binary.rhs instanceof Application || binary.rhs instanceof Lookup)
                //         && leftSort.is(Sort.Bool) {
                //     rhs = `isTrue[${right.res}]`;
                // }
                // return translatedFrom(`(${lhs} ${alloyOp} ${rhs})`, [left, right]);
                return translatedFrom(`(${left.res} ${alloyOp} ${right.res})`, [left, right]);
            } else {
                Logger.error("Unexpected operator for operands of type Bool :" + binary);
                throw new DebuggerError("Unexpected operator for operands of type Bool :" + binary);
            }
        }

        const left = leftSort.is(Sort.Bool) ? new LogicalWrapper(binary.lhs).accept(this) : binary.lhs.accept(this);
        if (left.res === undefined) {
            return leftover(binary, "Left-hand side operand not translated", left.leftovers);
        }

        const right = rightSort.is(Sort.Bool) ? new LogicalWrapper(binary.rhs).accept(this) : binary.rhs.accept(this);
        if (right.res === undefined) {
            return leftover(binary, "Right-hand side operand not translated", right.leftovers);
        }

        if (leftSort.is(Sort.Int) || rightSort.is(Sort.Int)) {
            switch (binary.op) {
                case '-': return this.coll_call('minus', leftSort, [binary.lhs, binary.rhs]);
                case '+': return this.coll_call('plus', leftSort, [binary.lhs, binary.rhs]);
                case '*': return this.coll_call('mul', leftSort, [binary.lhs, binary.rhs]);
                case '/': return this.coll_call('div', leftSort, [binary.lhs, binary.rhs]);
                case '%': return this.coll_call('rem', leftSort, [binary.lhs, binary.rhs]);
                case '<': return translatedFrom(`(${left.res} ${alloyOp} ${right.res})`, [left, right]);
                case '<=': return translatedFrom(`(${left.res} ${alloyOp} ${right.res})`, [left, right]);
                case '>': return translatedFrom(`(${left.res} ${alloyOp} ${right.res})`, [left, right]);
                case '>=': return translatedFrom(`(${left.res} ${alloyOp} ${right.res})`, [left, right]);
            }
        }

        // TODO: IntPermTimes, IntPermDIv, PermMin, 
        // Operations on permissions are translated to predicate calls
        if (leftSort.is(Sort.Perm) || rightSort.is(Sort.Perm)) {
            switch (binary.op) {
                // Perm comparison
                case '<': return this.coll_call('perm_less', Sort.Bool, [binary.lhs, binary.rhs]);
                case '<=': return this.coll_call('perm_at_most', Sort.Bool, [binary.lhs, binary.rhs]);
                case '>=': return this.coll_call('perm_at_least', Sort.Bool, [binary.lhs, binary.rhs]);
                case '>': return this.coll_call('perm_greater', Sort.Bool, [binary.lhs, binary.rhs]);
                // Perm arithmetic
                case '+': return this.coll_call('perm_plus', leftSort, [binary.lhs, binary.rhs]);
                case '-': return this.coll_call('perm_minus', leftSort, [binary.lhs, binary.rhs]);
                // Int-Perm multiplication always has the integer on the left in Silicon
                case '*': return leftSort.is(Sort.Int) ? this.coll_call('int_perm_mul', rightSort, [binary.lhs, binary.rhs])
                                                       : this.coll_call('perm_mul', leftSort, [binary.lhs, binary.rhs]);
                // Int-Perm division always has the integer on the left in Silicon
                case '/': return this.coll_call('int_perm_div', rightSort, [binary.lhs, binary.rhs]);
                case 'PermMin': return this.coll_call('perm_min', leftSort, [binary.lhs, binary.rhs]);
                case '==': return this.coll_call('perm_equals', Sort.Bool, [binary.lhs, binary.rhs]);
                // case '==': return translatedFrom(`(${left.res} = ${right.res})`, [left, right]);
                default: Logger.error(`Unexpected perm operator: ${binary.op}`);
            }
        }

        // If we are not dealing with a combine, then return a "regular" binary expression
        return translatedFrom(`(${left.res} ${alloyOp} ${right.res})`, [left, right]);
    }

    visitUnary(unary: Unary): TranslationRes {
        const termSort = getSort(unary.p);

        if (unary.op === "SetCardinality:" && termSort.is('Set')) {
            return this.coll_call('set_cardinality', Sort.Int, [unary.p]);
                // return translatedFrom(`#(${operand.res})`, [operand]);
        }

        const operand  = unary.p.accept(this); 
        if (!operand.res) {
            return leftover(unary, "Operand not translated", operand.leftovers);
        }

        if ((unary.p instanceof VariableTerm || unary.p instanceof Application || unary.p instanceof Lookup)
                && termSort.is(Sort.Bool)) {
            if (unary.op === "!") {
                return translatedFrom(`isFalse[${operand.res}]`, [operand]);
            }
        }

        return translatedFrom(`${unary.op}(${operand.res})`, [operand]);
    }

    visitSortWrapper(sortWrapper: SortWrapper): TranslationRes {
        const fromSort = getSort(sortWrapper.term);
        const toSort = sortWrapper.sort;

        const funName = `sortwrapper_${this.env.translate(fromSort)}_to_${this.env.translate(toSort)}`;
        if (!this.env.sortWrappers.has(funName)) {
            this.env.sortWrappers.set(funName, fromSort);
        }

        return this.coll_call(funName.toLowerCase(), toSort, [sortWrapper.term]);
    }

    visitVariableTerm(variable: VariableTerm): TranslationRes {
        const resolved = this.env.resolve(variable);
        if (resolved) {
            return translatedFrom(sanitize(resolved), []);
        }
        return leftover(variable, `Could not retrieve variable '${variable.toString()}'`, []);
    }

    visitQuantification(quantification: Quantification): TranslationRes {
        const tVars = quantification.vars.map(v => `${sanitize(v.id)}: ${this.env.translate(v.sort)}`);

        let mult: string;
        if (quantification.quantifier === 'QA') {
            mult = 'all';
        } else if (quantification.quantifier === 'QE') {
            mult = 'some';
        } else {
            throw new DebuggerError(`Unexpected quantifier '${quantification.quantifier}'`);
        }

        // Inside quantifiers, the quantified variables are defined as well
        return this.env.evaluateWithAdditionalVariables(
            quantification.vars.map(v => v.id),
            () => {
                const tBody = quantification.body.accept(this);

                if (!tBody.res) {
                    return leftover(quantification, "Could not translate quantified variables", tBody!.leftovers);
                }

                return translatedFrom(tBody.res, [tBody])
                            .withQuantifiedVariables(tVars.map(v => `${mult} ${v}`));
            });

    }

    visitApplication(application: Application): TranslationRes {
        const applicableSanitized = sanitize(application.applicable);

        if (applicableSanitized.endsWith('trigger')) {
            // TODO: Do we want to ignore these in the end?
            return leftover(application, "Explicitely ignoring trigger applications", []);
        }

        if (applicableSanitized.startsWith("sm") && application.sort.is('FVF')) {
            if (this.env.introduceMissingTempVars) {
                const snapshotMapVar = new VariableTerm(applicableSanitized, application.sort);
                this.env.recordTempVariable(snapshotMapVar);
                return snapshotMapVar.accept(this);
            } else {
                return leftover(application, "Not introducing new variable for snapshot map", []);
            }
        }

        if (applicableSanitized.startsWith("pTaken")) {
            return this.call(applicableSanitized, application.args);
        }

        const args: TranslationRes[] = [];
        const argStrings: string[] = [];
        const sorts: Sort[] = [];
        application.args.forEach(a => {
            const sort = getSort(a);
            let translated: TranslationRes;
            if (sort.is(Sort.Logical)) {
                translated = new BooleanWrapper(a).accept(this);
                sorts.push(Sort.Bool);
            } else {
                translated = a.accept(this);
                sorts.push(sort);
            }
            if (translated.res === undefined) {
                return leftover(application, "Could not translate some of the arguments", leftovers);
            }
            args.push(translated);
            argStrings.push(translated.res);
        });

        // Collect the leftovers from the translation of all arguments
        const leftovers = args.reduce(
            (acc, current) => acc.concat(current.leftovers),
            <Leftover[]>[]
        );

        // TODO: We probably need to handle inverse functions in a special way
        sorts.push(application.sort);
        this.env.recordFunction(applicableSanitized, sorts);

        // Get a fresh variable for the return value of the function and record the function call
        const callRes = this.env.getFreshVariable('fun_res', application.sort);
        this.env.recordFunctionCall(applicableSanitized, argStrings, callRes);
        
        return translatedFrom(callRes, args);
    }

    visitLookup(lookup: Lookup): TranslationRes {
        const receiver = lookup.receiver.accept(this);
        if (!receiver.res) {
            return leftover(lookup, "Could not translate receiver", receiver.leftovers);
        }

        const returnSort = getSort(lookup.fieldValueFunction);
        if (!(returnSort.is('FVF') && returnSort.elementsSort !== undefined)) {
            Logger.error(`Expected sort to a FVF, but was '${returnSort}': ` + lookup);
            throw new DebuggerError(`Expected sort to a FVF, but was '${returnSort}': ` + lookup);
        }

        const name = 'lookup_' + lookup.field;
        const f = new Application(name,
                                    [lookup.fieldValueFunction, lookup.receiver],
                                    returnSort.elementsSort);
        this.env.lookupFunctions.push([returnSort, lookup.field]);
        
        return f.accept(this);
    }

    // TODO: Implement this
    visitPredicateLookup(lookup: PredicateLookup): TranslationRes {
        return leftover(lookup, "Predicate Lookups not implemented", []);
    }

    visitAnd(and: And): TranslationRes {
        const terms = and.terms.map(t => t.accept(this));

        // Collect the leftovers from the translation of all terms
        const leftovers = terms.reduce(
            (acc, current) => acc.concat(current.leftovers),
            <Leftover[]>[]
        );

        // Translating some of the arguments has failed.
        if (terms.some(a => a.res === undefined)) {
            return leftover(and, "Could not translate some of the terms", leftovers);
        }

        return translatedFrom("(" + terms.map(t => t.res).join(" && ") + ")", terms);
    }

    visitOr(or: Or): TranslationRes {
        const terms = or.terms.map(t => t.accept(this));

        // Collect the leftovers from the translation of all terms
        const leftovers = terms.reduce(
            (acc, current) => acc.concat(current.leftovers),
            <Leftover[]>[]
        );

        // Translating some of the arguments has failed.
        if (terms.some(a => a.res === undefined)) {
            return leftover(or, "Could not translate some of the terms", leftovers);
        }

        return translatedFrom("(" + terms.map(t => t.res).join(" && ") + ")", terms);
    }

    // TODO: Implement this
    visitDistinct(distinct: Distinct): TranslationRes {
        return leftover(distinct, "'Distinct' term is not implemented", []);
    }

    visitIte(ite: Ite): TranslationRes {
        const conditionSort = getSort(ite.condition);
        const cond = conditionSort.is(Sort.Bool) ? new LogicalWrapper(ite.condition).accept(this)
                                                 : ite.condition.accept(this);
        const thenBranch = ite.thenBranch.accept(this);
        const elseBranch = ite.elseBranch.accept(this);

        const leftovers = cond.leftovers.concat(thenBranch.leftovers).concat(elseBranch.leftovers);
        if (!cond.res || !thenBranch.res || !elseBranch.res) {
            return leftover(ite, "Could not translate 'Ite'", leftovers);
        }

        const res = `(${cond.res} implies ${thenBranch.res} else ${elseBranch.res})`;
        return translatedFrom(res, [cond, thenBranch, elseBranch]);
    }

    // TODO: Implement this
    visitLet(term: Let): TranslationRes {
        return leftover(term, "Let translation not implemented", []);
    }

    visitLiteral(literal: Literal): TranslationRes {
        // TODO: Check bounds with env
        if (literal.sort.is(Sort.Int)) {
            return translatedFrom(literal.value, []);
        }
        if (literal.sort.is(Sort.Snap) && literal.value === '_') {
            return translatedFrom(AlloyTranslator.Unit, []);
        }
        if (literal.sort.is(Sort.Bool) && (literal.value === "True" || literal.value === "False")) {
            return translatedFrom(literal.value, []);
        }
        if (literal.sort.is(Sort.Ref) && literal.value === "Null") {
            return translatedFrom("NULL", []);
        }
        if (literal.sort.is('Seq') && literal.value === "Nil") {
            return leftover(literal, "Empty seq not implemented", []);
        }
        if (literal.sort.is('Set') && literal.value === 'Ø') {
            return translatedFrom("EmptySet", []);
        }
        if (literal.sort.is('Set') && literal.value === 'Ø') {
            return leftover(literal, "Empty multiset not implemented", []);
        }
        if (literal.sort.is(Sort.Perm)) {
            if (literal.value === AlloyTranslator.WritePerm) {
                return translatedFrom(AlloyTranslator.WritePerm, []);
            } else if (literal.value === AlloyTranslator.NoPerm) {
                return translatedFrom(AlloyTranslator.NoPerm, []);
            }

            const freshName = this.env.getFreshVariable('perm', Sort.Perm);
            const parts = literal.value.split('/');
            const fun_res = freshName + " = perm_new" + mkString(parts, '[', ", ", ']');
            return translatedFrom(freshName, [])
                    .withAdditionalFacts([fun_res]);
        }

        Logger.error("Unexpected literal: " + literal);
        return leftover(literal, "Unexpected literal: " + literal, []);
    }

    // TODO: Implement this
    visitSeqRanged(seqRanged: SeqRanged): TranslationRes {
        return leftover(seqRanged, "SeqRanged translation not implemented", []);
    }

    // TODO: Implement this
    visitSeqSingleton(seqSingleton: SeqSingleton): TranslationRes {
        return leftover(seqSingleton, "SeqSingleton translation not implemented", []);
    }

    // TODO: Implement this
    visitSeqUpdate(seqUpdate: SeqUpdate): TranslationRes {
        return leftover(seqUpdate, "SeqUpdate translation not implemented", []);
    }

    visitSetSingleton(setSingleton: SetSingleton): TranslationRes {
        return this.coll_call("set_singleton", getSort(setSingleton), [setSingleton.value]);
    }

    // TODO: Implement this
    visitMultiSetSingleton(multiSetSeingleton: MultisetSingleton): TranslationRes {
        return leftover(multiSetSeingleton, "MultisetSingleton translation not implemented", []);
    }

    visitLogicalWrapper(wrapper: LogicalWrapper): TranslationRes {
        const sort = getSort(wrapper.term);
        if (sort.is(Sort.Bool)) {
            const wrapped = wrapper.term.accept(this);
            if (wrapped.res) {
                return translatedFrom(`isTrue[${wrapped.res}]`, [wrapped]);
            } else {
                return leftover(wrapper, "Could not translate wrapped term", wrapped.leftovers);
            }
        } else if (sort.is(Sort.Logical)) {
            return wrapper.term.accept(this);
        }

        return leftover(wrapper, "Unexpected sort in boolean wrapper: " + sort, []);
    }
}