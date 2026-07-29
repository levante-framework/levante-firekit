import { afterEach, describe, expect, it } from 'vitest';
import { OfflineAppkit } from '../firestore/app/offlineAppkit';

describe('OfflineAppkit', () => {
  afterEach(async () => {
    await OfflineAppkit.clearAll();
  });

  it('records start, trials, and finish without Firebase', async () => {
    const kit = new OfflineAppkit(
      {
        localUserId: 'child-1',
        roarUid: 'uid-1',
        assignmentId: 'admin-1',
        taskId: 'hearts-and-flowers',
        packId: 'zh-pilot-1',
        variantParams: { language: 'zh-CN' },
      },
      { persist: false },
    );

    await kit.startRun({ device: 'test' });
    expect(kit.run?.completed).toBe(false);

    await kit.writeTrial({
      assessment_stage: 'test_response',
      correct: true,
      response: 'left',
    });
    await kit.writeTrial({
      assessment_stage: 'test_response',
      correct: false,
      response: 'right',
    });

    await kit.finishRun({ reason: 'done' });
    expect(kit.run?.completed).toBe(true);

    const current = kit.getCurrentRun();
    expect(current?.trials).toHaveLength(2);
    expect(current?.taskId).toBe('hearts-and-flowers');
    expect(current?.packId).toBe('zh-pilot-1');
    expect(current?.finishMetadata).toEqual({ reason: 'done' });
  });

  it('rejects trials missing reserved keys', async () => {
    const kit = new OfflineAppkit({ localUserId: 'child-1', taskId: 'vocab' }, { persist: false });
    await kit.startRun();
    await expect(kit.writeTrial({ correct: true })).rejects.toThrow(/assessment_stage/);
  });

  it('ignores writes after abort', async () => {
    const kit = new OfflineAppkit({ localUserId: 'child-1', taskId: 'vocab' }, { persist: false });
    await kit.startRun();
    kit.abortRun();
    await kit.writeTrial({ assessment_stage: 'test_response', correct: true });
    expect(kit.getCurrentRun()?.trials).toHaveLength(0);
  });
});
