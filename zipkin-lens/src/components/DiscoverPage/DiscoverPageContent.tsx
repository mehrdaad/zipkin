/*
 * Copyright 2015-2020 The OpenZipkin Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

/* eslint-disable no-shadow */

import { faHistory, faSync, faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Trans } from '@lingui/macro';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Container,
} from '@material-ui/core';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import SettingsIcon from '@material-ui/icons/Settings';
import moment from 'moment';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';

import Criterion, { newCriterion } from './Criterion';
import LookbackMenu from './LookbackMenu';
import SearchBar from './SearchBar';
import { Lookback, fixedLookbackMap, millisecondsToValue } from './lookback';
import { useUiConfig } from '../UiConfig';
import { clearTraces, loadTraces } from '../../actions/traces-action';
import { RootState } from '../../store';
import ExplainBox from '../Common/ExplainBox';

const TracesTab = require('./TracesTab').default;

interface DiscoverPageContentProps {
  autocompleteKeys: string[];
}

// Export for testing
export const useQueryParams = (autocompleteKeys: string[]) => {
  const history = useHistory();
  const location = useLocation();

  const setQueryParams = useCallback(
    (criteria: Criterion[], lookback: Lookback, limit: number) => {
      const params = new URLSearchParams();
      const annotationQuery: string[] = [];
      criteria.forEach((criterion) => {
        // If the key is 'tag' or a string included in autocompleteKeys,
        // the criterion will be included in annotationQuery.
        if (criterion.key === 'tagQuery') {
          annotationQuery.push(criterion.value);
        } else if (autocompleteKeys.includes(criterion.key)) {
          if (criterion.value) {
            annotationQuery.push(`${criterion.key}=${criterion.value}`);
          } else {
            annotationQuery.push(criterion.key);
          }
        } else {
          params.set(criterion.key, criterion.value);
        }
      });
      if (annotationQuery.length > 0) {
        params.set('annotationQuery', annotationQuery.join(' and '));
      }
      switch (lookback.type) {
        case 'fixed':
          params.set('lookback', lookback.value);
          params.set('endTs', lookback.endTime.valueOf().toString());
          break;
        case 'range':
          params.set('lookback', 'range');
          params.set('endTs', lookback.endTime.valueOf().toString());
          params.set('startTs', lookback.startTime.valueOf().toString());
          break;
        case 'millis':
          params.set('lookback', 'millis');
          params.set('endTs', lookback.endTime.valueOf().toString());
          params.set('millis', lookback.value.toString());
          break;
        default:
      }
      params.set('limit', limit.toString());
      history.push({
        pathname: location.pathname,
        search: params.toString(),
      });
    },
    [autocompleteKeys, history, location.pathname],
  );

  const criteria = useMemo(() => {
    const ret: Criterion[] = [];
    const params = new URLSearchParams(location.search);

    params.forEach((value, key) => {
      switch (key) {
        case 'lookback':
        case 'startTs':
        case 'endTs':
        case 'millis':
        case 'limit':
          break;
        case 'annotationQuery': {
          // Split annotationQuery into keys of autocompleteKeys and the others.
          // If the autocompleteKeys is ['projectID', 'phase'] and the annotationQuery is
          // 'projectID=projectA and phase=BETA and http.path=/api/v1/users and http.method=GET',
          // criterion will be like the following.
          // [
          //   { key: 'tagQuery', value: 'http.path=/api/v1/users and http.method=GET' },
          //   { key: 'projectID', value: 'projectA' },
          //   { key: 'phase', value: 'BETA' },
          // ]
          const tagQuery: string[] = [];
          const exps = value.split(' and ');
          exps.forEach((exp) => {
            const strs = exp.split('=');
            if (strs.length === 0) {
              return;
            }
            const [key, value] = strs;
            if (autocompleteKeys.includes(key)) {
              ret.push(newCriterion(key, value || ''));
            } else {
              tagQuery.push(exp);
            }
          });
          ret.push(newCriterion('tagQuery', tagQuery.join(' and ')));
          break;
        }
        default:
          ret.push(newCriterion(key, value));
          break;
      }
    });
    return ret;
  }, [autocompleteKeys, location.search]);

  const lookback = useMemo<Lookback | undefined>(() => {
    const ps = new URLSearchParams(location.search);
    const lookback = ps.get('lookback');
    if (!lookback) {
      return undefined;
    }

    switch (lookback) {
      case 'range': {
        const startTs = ps.get('startTs');
        const endTs = ps.get('endTs');
        if (!endTs || !startTs) {
          return undefined;
        }
        const startTime = moment(parseInt(startTs, 10));
        const endTime = moment(parseInt(endTs, 10));
        return {
          type: 'range',
          startTime,
          endTime,
        };
      }
      case 'millis': {
        const endTs = ps.get('endTs');
        const valueStr = ps.get('millis');
        if (!endTs || !valueStr) {
          return undefined;
        }
        const endTime = moment(parseInt(endTs, 10));
        const value = parseInt(valueStr, 10);
        return {
          type: 'millis',
          endTime,
          value,
        };
      }
      default: {
        // Otherwise lookback should be 1m, 5m 15m, ...
        const data = fixedLookbackMap[lookback];
        if (!data) {
          return undefined;
        }
        const endTs = ps.get('endTs');
        if (!endTs) {
          return undefined;
        }
        return {
          type: 'fixed',
          value: data.value,
          endTime: moment(parseInt(endTs, 10)),
        };
      }
    }
  }, [location.search]);

  const limit = useMemo(() => {
    const ps = new URLSearchParams(location.search);
    const limit = ps.get('limit');
    if (!limit) {
      return undefined;
    }
    return parseInt(limit, 10);
  }, [location.search]);

  return {
    setQueryParams,
    criteria,
    lookback,
    limit,
  };
};

// Export for testing
export const parseDuration = (duration: string) => {
  const regex = /^(\d+)(s|ms|us)?$/;
  const match = duration.match(regex);

  if (!match || match.length < 2) {
    return undefined;
  }
  if (match.length === 2 || typeof match[2] === 'undefined') {
    return parseInt(match[1], 10);
  }
  switch (match[2]) {
    case 's':
      return parseInt(match[1], 10) * 1000 * 1000;
    case 'ms':
      return parseInt(match[1], 10) * 1000;
    case 'us':
      return parseInt(match[1], 10);
    default:
      return undefined;
  }
};

// Export for testing
export const buildApiQuery = (
  criteria: Criterion[],
  lookback: Lookback,
  limit: number,
  autocompleteKeys: string[],
) => {
  const params: { [key: string]: string } = {};
  const annotationQuery: string[] = [];
  criteria.forEach((criterion) => {
    if (criterion.key === 'tagQuery') {
      annotationQuery.push(criterion.value);
    } else if (autocompleteKeys.includes(criterion.key)) {
      if (criterion.value) {
        annotationQuery.push(`${criterion.key}=${criterion.value}`);
      } else {
        annotationQuery.push(criterion.key);
      }
    } else if (
      criterion.key === 'minDuration' ||
      criterion.key === 'maxDuration'
    ) {
      const duration = parseDuration(criterion.value);
      if (duration) {
        params[criterion.key] = duration.toString();
      }
    } else {
      params[criterion.key] = criterion.value;
    }
  });
  if (annotationQuery.length > 0) {
    params.annotationQuery = annotationQuery.join(' and ');
  }

  params.endTs = lookback.endTime.valueOf().toString();
  switch (lookback.type) {
    case 'range': {
      const lb = lookback.endTime.valueOf() - lookback.startTime.valueOf();
      params.lookback = lb.toString();
      break;
    }
    case 'millis': {
      params.lookback = lookback.value.toString();
      break;
    }
    case 'fixed': {
      params.lookback = fixedLookbackMap[lookback.value].duration
        .asMilliseconds()
        .toString();
      break;
    }
    default:
  }

  params.limit = limit.toString();
  return params;
};

const useFetchTraces = (
  autocompleteKeys: string[],
  criteria: Criterion[],
  lookback?: Lookback,
  limit?: number,
) => {
  const dispatch = useDispatch();

  useEffect(() => {
    // For searching, lookback and limit are always required.
    // If it doesn't exist, clear traces.
    if (!lookback || !limit) {
      dispatch(clearTraces());
      return;
    }

    const params = buildApiQuery(criteria, lookback, limit, autocompleteKeys);
    dispatch(loadTraces(params));
  }, [autocompleteKeys, criteria, dispatch, limit, lookback]);
};

const initialLookback = (
  lookback: Lookback | undefined,
  defaultLookback: number,
): Lookback => {
  if (lookback) {
    return lookback;
  }
  const fixed = millisecondsToValue[defaultLookback];
  if (fixed) {
    return {
      type: 'fixed',
      value: fixed,
      endTime: moment(),
    };
  }
  return {
    type: 'millis',
    value: defaultLookback,
    endTime: moment(),
  };
};

const DiscoverPageContent: React.FC<DiscoverPageContentProps> = ({
  autocompleteKeys,
}) => {
  // Retrieve search criteria from the URL query string and use them to search for traces.
  const { setQueryParams, criteria, lookback, limit } = useQueryParams(
    autocompleteKeys,
  );
  useFetchTraces(autocompleteKeys, criteria, lookback, limit);

  // Temporary search criteria.
  const [tempCriteria, setTempCriteria] = useState(criteria);
  const { defaultLookback, queryLimit } = useUiConfig();
  const [tempLookback, setTempLookback] = useState<Lookback>(
    initialLookback(lookback, defaultLookback),
  );
  const [tempLimit, setTempLimit] = useState(limit || queryLimit);

  const lookbackDisplay = useMemo<string>(() => {
    switch (tempLookback.type) {
      case 'fixed':
        return fixedLookbackMap[tempLookback.value].display;
      case 'range':
        return `${tempLookback.startTime.format(
          'MM/DD/YYYY HH:mm:ss',
        )} - ${tempLookback.endTime.format('MM/DD/YYYY HH:mm:ss')}`;
      case 'millis':
        return `${tempLookback.value}ms`;
      default:
        return '';
    }
  }, [tempLookback]);

  const handleLimitChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setTempLimit(parseInt(event.target.value, 10));
    },
    [],
  );

  const searchTraces = useCallback(() => {
    const criteria = tempCriteria.filter((c) => !!c.key);

    // If the lookback is fixed or millis, need to set the click time to endTime.
    if (tempLookback.type === 'fixed' || tempLookback.type === 'millis') {
      setQueryParams(
        criteria,
        { ...tempLookback, endTime: moment() },
        tempLimit,
      );
    } else {
      setQueryParams(criteria, tempLookback, tempLimit);
    }
  }, [setQueryParams, tempCriteria, tempLookback, tempLimit]);

  const [traces, isLoadingTraces] = useSelector((state: RootState) => [
    state.traces.traces,
    state.traces.isLoading,
  ]);

  const [isShowingLookbackMenu, setIsShowingLookbackMenu] = useState(false);

  const toggleLookbackMenu = useCallback(() => {
    setIsShowingLookbackMenu((prev) => !prev);
  }, []);

  const closeLookbackMenu = useCallback(() => {
    setIsShowingLookbackMenu(false);
  }, []);

  const [isOpeningSettings, setIsOpeningSettings] = useState(false);

  const handleSettingsButtonClick = useCallback(() => {
    setIsOpeningSettings((prev) => !prev);
  }, []);

  let content: JSX.Element | undefined;

  if (isLoadingTraces) {
    content = (
      <Box
        width="100%"
        height="100vh"
        top={0}
        position="fixed"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <CircularProgress />
      </Box>
    );
  } else if (traces.length === 0) {
    content = (
      <ExplainBox
        icon={faSearch}
        headerText={<Trans>Search Traces</Trans>}
        text={
          <Trans>
            Please select criteria in the search bar. Then, click the search
            button.
          </Trans>
        }
      />
    );
  } else {
    content = (
      <Paper elevation={3}>
        <TracesTab />
      </Paper>
    );
  }

  return (
    <Box
      width="100%"
      height="calc(100vh - 64px)"
      display="flex"
      flexDirection="column"
    >
      <Box bgcolor="background.paper" boxShadow={3} pt={3} pb={3} zIndex={1000}>
        <Container>
          <Box display="flex">
            <Box flexGrow={1} mr={1}>
              <SearchBar
                criteria={tempCriteria}
                onChange={setTempCriteria}
                searchTraces={searchTraces}
              />
            </Box>
            <SearchButton onClick={searchTraces}>Run Query</SearchButton>
            <SettingsButton
              onClick={handleSettingsButtonClick}
              isOpening={isOpeningSettings}
              data-testid="settings-button"
            >
              <SettingsIcon />
            </SettingsButton>
          </Box>
          {isOpeningSettings ? (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="flex-end"
              mt={1.75}
            >
              <Box mr={1} position="relative">
                <LookbackButton
                  onClick={toggleLookbackMenu}
                  isShowingLookbackMenu={isShowingLookbackMenu}
                >
                  {lookbackDisplay}
                </LookbackButton>
                {isShowingLookbackMenu && (
                  <LookbackMenu
                    close={closeLookbackMenu}
                    onChange={setTempLookback}
                    lookback={tempLookback}
                  />
                )}
              </Box>
              <TextField
                label="Limit"
                type="number"
                variant="outlined"
                value={tempLimit}
                onChange={handleLimitChange}
                size="small"
                inputProps={{
                  'data-testid': 'query-limit',
                }}
              />
            </Box>
          ) : null}
        </Container>
      </Box>
      <Box flexGrow={1} overflow="auto" pt={3} pb={3}>
        <Container>{content}</Container>
      </Box>
    </Box>
  );
};

export default DiscoverPageContent;

const LookbackButton = styled(Button).attrs<{ isShowingLookbackMenu: boolean }>(
  ({ isShowingLookbackMenu }) => ({
    variant: 'outlined',
    startIcon: <FontAwesomeIcon icon={faHistory} />,
    endIcon: isShowingLookbackMenu ? <ExpandLessIcon /> : <ExpandMoreIcon />,
  }),
)<{ isShowingLookbackMenu: boolean }>`
  /* Align LookbackButton height with the TextField height. */
  padding-top: 7.5px;
  padding-bottom: 7.5px;
`;

const SearchButton = styled(Button).attrs({
  variant: 'contained',
  color: 'primary',
  startIcon: <FontAwesomeIcon icon={faSync} />,
})`
  flex-shrink: 0;
  height: 60px;
  min-width: 60px;
  color: ${({ theme }) => theme.palette.common.white};
`;

const SettingsButton = styled(Button).attrs<{ isOpening: boolean }>(
  ({ isOpening }) => ({
    variant: 'outlined',
    endIcon: isOpening ? <ExpandLessIcon /> : <ExpandMoreIcon />,
  }),
)<{ isOpening: boolean }>`
  flex-shrink: 0;
  height: 60px;
  min-width: 0px;
  margin-left: ${({ theme }) => theme.spacing(1)}px;
`;
