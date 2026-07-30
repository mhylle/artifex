/**
 * Mission intake from the cockpit.
 *
 * The gap this closes: Mission Control could *watch* a mission but never start
 * one, so the only way to put work into Artifex was curl. An operator surface
 * that can observe but not act is a dashboard, not a control plane.
 */
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { INTAKE_DEFAULTS, MissionIntake, toLines } from './mission-intake';

describe('toLines', () => {
  it('splits a textarea into trimmed, non-empty lines', () => {
    expect(toLines('  first \n\n second  \n')).toEqual(['first', 'second']);
  });

  it('DISTRACTOR: whitespace-only input yields no lines, not one blank one', () => {
    // A blank criterion would satisfy the API's "at least one" check while
    // being ungradeable — exactly the thing intake is supposed to refuse.
    expect(toLines('   \n  \n')).toEqual([]);
  });
});

describe('MissionIntake', () => {
  let intake: MissionIntake;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    intake = TestBed.inject(MissionIntake);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the draft to /missions and returns the new mission id', async () => {
    const pending = intake.submit(
      { objective: 'Explain heat pumps.', successCriteria: ['Names a COP figure.'], outOfScope: [] },
      'http://api.test',
    );

    const request = http.expectOne('http://api.test/missions');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.objective).toBe('Explain heat pumps.');
    expect(request.request.body.successCriteria).toEqual(['Names a COP figure.']);
    request.flush({ missionId: 'm-42' });

    await expect(pending).resolves.toBe('m-42');
  });

  it('sends every field the contract requires, so a valid draft cannot 500', async () => {
    // The API types its body against a TS interface, which is erased at runtime:
    // a missing field is not a 400, it is an unhandled TypeError. The client is
    // therefore the only thing standing between an operator and a 500.
    const pending = intake.submit(
      { objective: 'Explain heat pumps.', successCriteria: ['Names a COP figure.'], outOfScope: ['No costs.'] },
      'http://api.test',
    );

    const request = http.expectOne('http://api.test/missions');
    const body = request.request.body as Record<string, unknown>;
    for (const field of ['objective', 'successCriteria', 'outOfScope', 'autonomyDial', 'budget', 'blastRadius', 'requestedBy']) {
      expect(body[field], `intake body must carry "${field}"`).toBeDefined();
    }
    expect(body['budget']).toEqual(INTAKE_DEFAULTS.budget);
    request.flush({ missionId: 'm-42' });

    await pending;
  });
});
