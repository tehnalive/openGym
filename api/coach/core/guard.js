/* "Only about training": what the server does with an answer on top of the prompt's rules.
 *
 * The prompt (prompts/guard.md) tells the model to mark every answer `on_topic` and to refuse
 * anything else, but a model is not a gate. This is: the answer is shown only when the flag is
 * strictly `true` and the text passes the checks below; in every other case the lifter gets REFUSAL
 * and the model's own text is dropped on the floor, never stored and never sent to the client.
 * One request per question: the flag rides in the same answer, so topic checking costs no extra
 * call against a free model's request budget.
 *
 * Pure and framework-free: it runs on the server, where the guard is switched on (jobs.js). */

export const REFUSAL = 'Я отвечаю только на вопросы о ваших тренировках: журнал и статистика, прогресс, план, замеры, восстановление, техника упражнений и питание в связи с тренировками. Задайте вопрос на эту тему.';

// A training answer has no use for a link, a code block or a shell line; a jailbroken one often has.
const NOT_FOR_A_COACH = /https?:\/\/|www\.|```|<\s*script|<\s*iframe/i;

/** The flag the model set: only the boolean `true` counts. */
export const flaggedOnTopic = data => !!data && data.on_topic === true;

/** Whether a free-text answer may be shown as it is. */
export const answerAllowed = text => typeof text === 'string' && text.trim().length > 0 && !NOT_FOR_A_COACH.test(text);

/** The proposal an off-topic or unusable question ends in: the fixed text, marked as a refusal. */
export const refusalProposal = () => ({ answer: REFUSAL, offtopic: true });
